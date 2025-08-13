import './styles/index.css';
import { initMicroInteractions } from './ui/microinteractions';
import { wireWindowControls } from './ui/windowControls';
import addHtml from './components/add.html?raw';
import { initI18n } from './ui/i18n';
import { applyThemeToDocument, getSavedTheme } from './ui/settings';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

function formatBytes(bytes?: number | null): string {
  if (!Number.isFinite(bytes as number) || (bytes as number) <= 0) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  let n = bytes as number;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

function joinPath(dir: string, sub: string): string {
  if (!dir) return sub;
  const hasBack = /[\\/]$/.test(dir);
  const sep = dir.includes('\\') ? '\\' : '/';
  return hasBack ? `${dir}${sub}` : `${dir}${sep}${sub}`;
}

(async function mount(){
  const app = document.createElement('div');
  app.className = 'app-shell fade-in';
  app.innerHTML = addHtml;
  document.body.appendChild(app);

  // i18n + theme + UI wiring
  initI18n(document);
  applyThemeToDocument(getSavedTheme());
  initMicroInteractions();
  wireWindowControls();

  // Refs
  const urlInput = document.getElementById('addwin-url') as HTMLInputElement;
  const urlField = document.getElementById('addwin-url-field') as HTMLDivElement;
  const pasteBtn = document.getElementById('addwin-paste') as HTMLButtonElement;
  const catFx = document.getElementById('addwin-category') as HTMLDivElement;
  const catTrigger = catFx.querySelector('.trigger') as HTMLButtonElement;
  const catMenu = catFx.querySelector('.fx-menu') as HTMLUListElement;
  const catLabel = catFx.querySelector('.selected-label') as HTMLElement;
  const sizeEl = document.getElementById('addwin-size') as HTMLDivElement;
  const pathInput = document.getElementById('addwin-path') as HTMLInputElement;
  const nameInput = document.getElementById('addwin-filename') as HTMLInputElement;
  const cancelBtn = document.querySelector('[data-action="cancel"]') as HTMLButtonElement;
  const startBtn = document.querySelector('[data-action="start"]') as HTMLButtonElement;
  const urlErrIcon = document.getElementById('addwin-url-err') as HTMLElement;

  const closeWindow = async () => {
    try { await getCurrentWindow().close(); } catch {}
  };

  function validateUrl(value: string): boolean {
    urlErrIcon.classList.add('hidden');
    urlField.classList.remove('has-error');
    try {
      const u = new URL(value);
      const ok = u.protocol === 'https:'; // only allow https per UX request
      if (!ok) { urlErrIcon.classList.remove('hidden'); urlField.classList.add('has-error'); }
      return ok;
    } catch {
      urlErrIcon.classList.remove('hidden');
      urlField.classList.add('has-error');
      return false;
    }
  }

  function getCategory(): string {
    return catFx.dataset.value || 'other';
  }

  function setCategory(val: string, fromUser = false) {
    const options = Array.from(catMenu.querySelectorAll<HTMLElement>('.option'));
    let label = val;
    options.forEach((opt) => {
      const selected = opt.getAttribute('data-value') === val;
      opt.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) label = opt.textContent || val;
    });
    catFx.dataset.value = val;
    catLabel.textContent = label;
    // Keep i18n key in sync so language switching updates label correctly
    catLabel.setAttribute('data-i18n', `sidebar.btn.${val}`);
    if (fromUser) {
      catFx.dataset.userChanged = '1';
      try { localStorage.setItem('adm.selectedCategory', val); } catch {}
      // Update path suffix if last segment is a category
      const cur = pathInput.value;
      if (cur) {
        const parts = cur.replace(/\\/g, '/').split('/');
        const cats = ['image','music','video','apps','document','compressed','other'];
        if (val !== 'auto') {
          if (parts.length >= 1 && cats.includes(parts[parts.length - 1])) {
            parts[parts.length - 1] = val;
            const sep = cur.includes('\\') ? '\\' : '/';
            pathInput.value = parts.join(sep);
          }
        }
      }
    }
  }

  async function probeAndFill() {
    const url = (urlInput.value || '').trim();
    if (!validateUrl(url)) {
      sizeEl.textContent = '—';
      nameInput.value = '';
      pathInput.value = '';
      return;
    }
    sizeEl.textContent = '…';
    try {
      const res = await invoke<{ total: number | null; file_name: string; category: string; download_dir: string }>('probe_url', { url });
      // Category: prefer existing selection if user already changed it, otherwise from probe or stored prefer
      if (!catFx.dataset.userChanged) {
        const prefer = localStorage.getItem('adm.selectedCategory') || '';
        setCategory(prefer || 'auto');
      }
      sizeEl.textContent = formatBytes(res.total);
      if (!pathInput.value) {
        const base = res.download_dir || '';
        const chosen = getCategory();
        const catForPath = chosen === 'auto' ? (res.category || 'other') : chosen;
        pathInput.value = joinPath(base, catForPath);
      }
      if (!nameInput.value) {
        nameInput.value = res.file_name || 'download.bin';
      }
    } catch (e) {
      console.error(e);
      sizeEl.textContent = '—';
      nameInput.value = '';
      pathInput.value = '';
    }
  }

  // Events
  pasteBtn?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        await probeAndFill();
      }
    } catch (e) {
      console.warn('Clipboard read failed', e);
    }
  });

  urlInput.addEventListener('change', probeAndFill);
  urlInput.addEventListener('blur', probeAndFill);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void probeAndFill(); });

  // fx-select interactions with portal menu
  let catMenuPlaceholder: Comment | null = null;
  const restoreMenu = () => {
    if (catMenuPlaceholder && catMenuPlaceholder.parentNode) {
      catMenu.classList.remove('portal');
      catMenu.style.cssText = '';
      catMenuPlaceholder.parentNode.replaceChild(catMenu, catMenuPlaceholder);
      catMenuPlaceholder = null;
    }
  };
  const positionMenu = () => {
    const rect = catTrigger.getBoundingClientRect();
    catMenu.classList.add('portal');
    catMenu.style.minWidth = `${Math.max(rect.width, 220)}px`;
    const desired = Math.min(360, window.innerHeight * 0.5);
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < desired + 16) {
      catMenu.style.top = `${Math.max(8, rect.top - 8 - Math.min(desired, rect.top - 8))}px`;
      catMenu.style.left = `${Math.max(8, rect.left)}px`;
    } else {
      catMenu.style.top = `${rect.bottom + 8}px`;
      catMenu.style.left = `${Math.max(8, rect.left)}px`;
    }
  };
  catTrigger.addEventListener('click', () => {
    const willOpen = !catFx.classList.contains('open');
    catFx.classList.toggle('open');
    catTrigger.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      // move menu to body as portal and position
      if (!catMenuPlaceholder) {
        catMenuPlaceholder = document.createComment('cat-menu');
        catMenu.parentElement?.replaceChild(catMenuPlaceholder, catMenu);
        document.body.appendChild(catMenu);
      }
      positionMenu();
      window.addEventListener('resize', positionMenu, { passive: true });
      window.addEventListener('scroll', positionMenu, { passive: true });
    }
  });
  catMenu.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('.option') as HTMLElement | null;
    if (!li) return;
    const val = li.getAttribute('data-value') || 'other';
    setCategory(val, true);
    catFx.classList.remove('open');
    catTrigger.setAttribute('aria-expanded', 'false');
    restoreMenu();
    window.removeEventListener('resize', positionMenu);
    window.removeEventListener('scroll', positionMenu);
  });
  document.addEventListener('click', (e) => {
    if (!catFx.contains(e.target as Node) && !catMenu.contains(e.target as Node)) {
      catFx.classList.remove('open');
      catTrigger.setAttribute('aria-expanded', 'false');
      restoreMenu();
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      catFx.classList.remove('open');
      catTrigger.setAttribute('aria-expanded', 'false');
      restoreMenu();
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu);
    }
  });

  cancelBtn.addEventListener('click', () => { void closeWindow(); });

  startBtn.addEventListener('click', async () => {
    const url = (urlInput.value || '').trim();
    if (!validateUrl(url)) return;
    const threads = 4;
    const destDir = (pathInput.value || '').trim();
    const fileName = (nameInput.value || '').trim() || 'download.bin';
    startBtn.disabled = true;
    try {
      // Start download and close window immediately
      void invoke<string>('start_download', { url, threads, dest_dir: destDir, file_name: fileName }).catch((err) => {
        console.error(err);
      });
      await closeWindow();
    } catch (err) {
      console.error(err);
      startBtn.disabled = false;
    }
  });

  // Init: apply preferred category and focus URL
  setCategory(localStorage.getItem('adm.selectedCategory') || 'auto');
  setTimeout(() => urlInput.focus(), 0);
})();
