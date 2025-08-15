/*
  设置页交互：
  - 左侧分类导航
  - 主题与语言选择（目前仅保存到 localStorage 并广播给主窗口）
*/

type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY_THEME = 'adm.theme';
// Language is managed via i18n module
import { setLang, getSavedLang } from './i18n';

export function initSettingsUI(): void {
  bindCategoryNav();
  initThemeControls();
  initLanguageControls();
}

function bindCategoryNav(): void {
  document.querySelectorAll('[data-cat]')?.forEach(el => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.cat!;
      document.querySelectorAll('.settings-content')?.forEach(s => s.classList.add('hidden'));
      document.getElementById(id)?.classList.remove('hidden');
      document.querySelectorAll('.settings-sidebar .btn')?.forEach(b => b.classList.remove('active'));
      (el as HTMLElement).classList.add('active');
    });
  });
}

function initThemeControls(): void {
  const current = (localStorage.getItem(STORAGE_KEY_THEME) as ThemeMode) || 'system';
  const container = document.getElementById('theme-select');
  if (container) {
    initSelect(container, current, (next: string) => {
      localStorage.setItem(STORAGE_KEY_THEME, next);
      applyThemeToDocument(next as ThemeMode);
      broadcastTheme(next as ThemeMode);
    });
  }
  applyThemeToDocument(current);
}

function initLanguageControls(): void {
  const current = getSavedLang();
  const container = document.getElementById('lang-select');
  if (container) {
    initSelect(container, current, (next: string) => {
      setLang(next as any);
    });
  }
}

// Global variable to track currently open select
let currentlyOpenSelect: HTMLElement | null = null;

// Reusable custom select initializer
function initSelect(container: HTMLElement, initialValue: string, _onChange: (value: string) => void): void {
  const trigger = container.querySelector<HTMLButtonElement>('.trigger');
  const label = container.querySelector<HTMLSpanElement>('.selected-label');
  const menu = container.querySelector<HTMLUListElement>('.menu');
  const options = Array.from(container.querySelectorAll<HTMLLIElement>('.option'));

  if (!trigger || !label || !menu) return;

  // Set initial state
  let selectedValue = initialValue;
  const initialOption = options.find(opt => opt.dataset.value === initialValue);
  if (initialOption) {
    label.textContent = initialOption.textContent;
    initialOption.setAttribute('aria-selected', 'true');
  } else {
    // Fallback if initial value not found
    label.textContent = options[0]?.textContent || '';
    options[0]?.setAttribute('aria-selected', 'true');
    selectedValue = options[0]?.dataset.value || '';
  }

  // Event listeners
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    
    // Close other open selects first
    if (currentlyOpenSelect && currentlyOpenSelect !== container) {
      currentlyOpenSelect.classList.remove('open');
    }
    
    // Toggle current select
    const isOpening = !container.classList.contains('open');
    container.classList.toggle('open');
    
    // Update global tracker
    if (isOpening) {
      currentlyOpenSelect = container;
    } else {
      currentlyOpenSelect = null;
    }
  });

  document.addEventListener('click', () => {
    container.classList.remove('open');
    if (currentlyOpenSelect === container) {
      currentlyOpenSelect = null;
    }
  });

  // When language changes, update the label text
  const refreshLabel = () => {
    const currentOption = options.find(opt => opt.dataset.value === selectedValue);
    if (currentOption) {
      label.textContent = currentOption.textContent;
    }
  };
  window.addEventListener('adm:lang-changed', refreshLabel);
  window.addEventListener('storage', (e) => { if (e.key === 'adm.lang') refreshLabel(); });
}

export function applyThemeToDocument(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark-theme', isDark);
  } else if (mode === 'dark') {
    root.classList.add('dark-theme');
  } else {
    root.classList.remove('dark-theme');
  }
}

function broadcastTheme(mode: ThemeMode): void {
  try {
    const ce = new CustomEvent('adm:theme-changed', { detail: { mode } });
    window.dispatchEvent(ce);
  } catch {}
}

export function getSavedTheme(): ThemeMode {
  return (localStorage.getItem(STORAGE_KEY_THEME) as ThemeMode) || 'system';
}
