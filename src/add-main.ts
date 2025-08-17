import './styles/index.css';
import { initMicroInteractions } from './ui/microinteractions';
import { wireWindowControls } from './ui/windowControls';
import addHtml from './components/add.html?raw';
import { initI18n, t } from './ui/i18n';
import { applyThemeToDocument, getSavedTheme } from './ui/settings';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

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
  const catMenu = catFx.querySelector('.menu') as HTMLUListElement;
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

  // If launched with ?url=... prefill and probe
  try {
    const initial = new URLSearchParams(location.search).get('url');
    if (initial) {
      urlInput.value = initial;
      // defer to ensure DOM is ready
      setTimeout(() => { void probeAndFill(); }, 0);
    }
  } catch {}

  // Listen for prefill event from main window
  try {
    void listen<string>('adm-prefill-url', (evt) => {
      const link = (evt.payload || '').trim();
      if (link) {
        urlInput.value = link;
        void probeAndFill();
      }
    });
  } catch {}

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

  // Keep last detected info from probe
  let lastDetectedCat: string = 'other';
  let lastDownloadDir: string = '';

  function updateCategoryLabel() {
    const val = getCategory();
    if (val === 'auto') {
      const detected = lastDetectedCat || 'other';
      catLabel.textContent = `${t('sidebar.btn.auto')}（${t('sidebar.btn.' + detected)}）`;
      // avoid applyI18n overriding dynamic label
      catLabel.removeAttribute('data-i18n');
    } else {
      catLabel.textContent = t(`sidebar.btn.${val}`);
      catLabel.setAttribute('data-i18n', `sidebar.btn.${val}`);
    }
  }

  function getCategory(): string {
    return catFx.dataset.value || 'other';
  }

  function setCategory(val: string, fromUser = false) {
    const options = Array.from(catMenu.querySelectorAll<HTMLElement>('.option'));
    options.forEach((opt) => {
      const selected = opt.getAttribute('data-value') === val;
      opt.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    catFx.dataset.value = val;
    updateCategoryLabel();
    if (fromUser) {
      catFx.dataset.userChanged = '1';
      try { localStorage.setItem('adm.selectedCategory', val); } catch {}
      // Recompute full path on user selection
      const base = lastDownloadDir || '';
      const catForPath = val === 'auto' ? (lastDetectedCat || 'other') : val;
      pathInput.value = joinPath(base, catForPath);
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
      lastDetectedCat = (res.category || 'other');
      lastDownloadDir = (res.download_dir || '');
      // Category: prefer existing selection if user already changed it, otherwise from probe or stored prefer
      if (!catFx.dataset.userChanged) {
        const prefer = localStorage.getItem('adm.selectedCategory') || '';
        setCategory(prefer || 'auto');
      }
      // Always refresh the auto label as detection may have changed
      updateCategoryLabel();
      sizeEl.textContent = formatBytes(res.total);
      const chosen = getCategory();
      const base = lastDownloadDir;
      const catForPath = chosen === 'auto' ? (lastDetectedCat || 'other') : chosen;
      // If empty OR current path doesn't match chosen category, update it
      const cur = (pathInput.value || '').trim();
      const shouldUpdate = !cur || !cur.replace(/\\/g, '/').endsWith(`/${catForPath}`);
      if (shouldUpdate) pathInput.value = joinPath(base, catForPath);
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

  catTrigger.addEventListener('click', () => {
    const willOpen = !catFx.classList.contains('open');
    
    // Close any other open selects first (for consistency with settings)
    document.querySelectorAll('.select.open').forEach(select => {
      if (select !== catFx) {
        select.classList.remove('open');
        const trigger = select.querySelector('.trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    });
    
    catFx.classList.toggle('open');
    catTrigger.setAttribute('aria-expanded', String(willOpen));
  });

  catMenu.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('.option') as HTMLElement | null;
    if (!li) return;
    const val = li.getAttribute('data-value') || 'other';
    setCategory(val, true);
    catFx.classList.remove('open');
    catTrigger.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('click', (e) => {
    if (!catFx.contains(e.target as Node)) {
      catFx.classList.remove('open');
      catTrigger.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      catFx.classList.remove('open');
      catTrigger.setAttribute('aria-expanded', 'false');
    }
  });

  cancelBtn.addEventListener('click', () => { void closeWindow(); });

  startBtn.addEventListener('click', async () => {
    const url = (urlInput.value || '').trim();
    if (!validateUrl(url)) return;
    const threads = 4;
    let destDir = (pathInput.value || '').trim();
    // If user clicked Download before probe completed, synthesize a path now
    if (!destDir) {
      const chosen = getCategory();
      const catForPath = chosen === 'auto' ? (lastDetectedCat || 'other') : chosen;
      destDir = joinPath(lastDownloadDir || '', catForPath);
      pathInput.value = destDir;
    }
    const fileName = (nameInput.value || '').trim() || 'download.bin';
    startBtn.disabled = true;
    try {
      // Start download and close window immediately
      void invoke<string>('start_download', { url, threads, destDir, fileName }).catch((err) => {
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
  // Update dynamic auto label on language change
  window.addEventListener('adm:lang-changed', () => updateCategoryLabel());
  setTimeout(() => urlInput.focus(), 0);
})();
