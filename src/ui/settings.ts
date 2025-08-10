/*
  设置页交互：
  - 左侧分类导航
  - 主题与语言选择（目前仅保存到 localStorage 并广播给主窗口）
*/

type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY_THEME = 'adm.theme';
const STORAGE_KEY_LANG = 'adm.lang';

export function initSettingsUI(): void {
  bindCategoryNav();
  initThemeControls();
  initLanguageControls();
  enhanceModernSelects();
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
  const select = document.getElementById('theme-select') as HTMLSelectElement | null;
  if (select) {
    select.value = current;
    select.addEventListener('change', () => {
      const next = select.value as ThemeMode;
      localStorage.setItem(STORAGE_KEY_THEME, next);
      applyThemeToDocument(next);
      broadcastTheme(next);
    });
  }
  applyThemeToDocument(current);
}

function initLanguageControls(): void {
  const current = localStorage.getItem(STORAGE_KEY_LANG) || 'system';
  const select = document.getElementById('lang-select') as HTMLSelectElement | null;
  if (select) {
    select.value = current;
    select.addEventListener('change', () => {
      const next = select.value;
      localStorage.setItem(STORAGE_KEY_LANG, next);
      // 预留：未来接入 i18n。此处仅保存。
    });
  }
}

// 用自定义弹出菜单替换原生下拉（更现代化）
function enhanceModernSelects(): void {
  document.querySelectorAll('label.select > select').forEach((nativeSelect) => {
    const label = nativeSelect.parentElement as HTMLElement;
    // 若已增强过则跳过
    if (label.nextElementSibling && label.nextElementSibling.classList.contains('fx-select')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'fx-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'trigger';
    trigger.textContent = (nativeSelect as HTMLSelectElement).selectedOptions[0]?.text || '';

    const menu = document.createElement('div');
    menu.className = 'fx-menu';

    Array.from((nativeSelect as HTMLSelectElement).options).forEach((opt, idx) => {
      const item = document.createElement('div');
      item.className = 'option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(opt.selected));
      item.textContent = opt.text;
      item.addEventListener('click', () => {
        (nativeSelect as HTMLSelectElement).selectedIndex = idx;
        (nativeSelect as HTMLSelectElement).dispatchEvent(new Event('change', { bubbles: true }));
        trigger.textContent = opt.text;
        wrapper.classList.remove('open');
        menu.querySelectorAll('.option').forEach(o => o.setAttribute('aria-selected', 'false'));
        item.setAttribute('aria-selected', 'true');
      });
      menu.appendChild(item);
    });

    trigger.addEventListener('click', () => {
      wrapper.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target as Node)) wrapper.classList.remove('open');
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    label.after(wrapper);
    label.style.display = 'none';
  });
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


