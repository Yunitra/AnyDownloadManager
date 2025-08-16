import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener';
import { applyI18n, t } from './i18n';

interface StartedPayload {
  id: string;
  url: string;
  file_name: string;
  total: number | null;
  dest_dir?: string; // provided by backend; optional for backward compatibility
}
interface ProgressPayload {
  id: string;
  received: number;
  total: number;
  speed: number;
}
interface CompletedPayload { id: string; path: string }
interface FailedPayload { id: string; error: string }

type RowRefs = {
  row: HTMLDivElement;
  name: HTMLDivElement;
  size: HTMLDivElement;
  status: HTMLDivElement;
  speed: HTMLDivElement;
  date: HTMLDivElement;
  bar?: HTMLDivElement; // progress bar element
  lastSpeed?: number;
  finished?: boolean;
  id: string;
  path?: string; // full file path to final file
};

const rows = new Map<string, RowRefs>();
const HISTORY_KEY = 'adm.history';

type HistoryItem = {
  id: string;
  url: string;
  file_name: string;
  total: number | null;
  path?: string;
  status: 'downloading' | 'finished' | 'failed' | 'canceled';
  created_at: number; // epoch ms
};

function safeJoin(dir: string | undefined, file: string): string | undefined {
  if (!dir) return undefined;
  const hasBack = /[\\/]$/.test(dir);
  const sep = dir.includes('\\') ? '\\' : '/';
  return hasBack ? `${dir}${file}` : `${dir}${sep}${file}`;
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as HistoryItem[];
    if (Array.isArray(arr)) return arr;
  } catch {}
  return [];
}

function saveHistory(items: HistoryItem[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch {}
}

function upsertHistory(item: HistoryItem): void {
  const list = loadHistory();
  const idx = list.findIndex(i => i.id === item.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...item };
  else list.unshift(item);
  saveHistory(list);
}

function removeFromHistory(id: string): void {
  const list = loadHistory().filter(i => i.id !== id);
  saveHistory(list);
}
let cleanupDemoDone = false;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  return `${formatBytes(bytesPerSec)}/s`;
}

function cleanupDemoRows(table: HTMLElement) {
  if (cleanupDemoDone) return;
  table.querySelectorAll(':scope > .row').forEach((el) => el.remove());
  cleanupDemoDone = true;
}

function createRow(started: StartedPayload): RowRefs {
  const table = document.querySelector<HTMLElement>('section.table');
  if (!table) throw new Error('table not found');
  cleanupDemoRows(table);

  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.id = started.id;

  const colName = document.createElement('div');
  colName.className = 'name';
  colName.textContent = started.file_name || started.url;
  // Tooltip for full name
  colName.title = started.file_name || started.url;

  const colSize = document.createElement('div');
  colSize.textContent = started.total && started.total > 0 ? formatBytes(started.total) : '—';

  const colStatus = document.createElement('div');
  let bar: HTMLDivElement | undefined;
  if (started.total && started.total > 0) {
    const progress = document.createElement('div');
    progress.className = 'progress';
    progress.setAttribute('data-i18n-attr','aria-label:table.progress');
    progress.setAttribute('aria-label', t('table.progress'));
    progress.setAttribute('role','progressbar');
    progress.setAttribute('aria-valuemin','0');
    progress.setAttribute('aria-valuemax','100');

    bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = '0%';

    progress.appendChild(bar);
    colStatus.appendChild(progress);
  } else {
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = t('table.status.downloading');
    colStatus.appendChild(badge);
  }

  const colSpeed = document.createElement('div');
  colSpeed.textContent = '—';

  const colDate = document.createElement('div');
  const span = document.createElement('span');
  span.setAttribute('data-rel-time', '0');
  span.setAttribute('data-rel-unit', 'second');
  colDate.appendChild(span);

  row.appendChild(colName);
  row.appendChild(colSize);
  row.appendChild(colStatus);
  row.appendChild(colSpeed);
  row.appendChild(colDate);

  table.appendChild(row);
  applyI18n(row);

  const refs: RowRefs = { row, name: colName, size: colSize, status: colStatus, speed: colSpeed, date: colDate, bar, id: started.id };
  // If backend provided dest_dir, build full path early so context menu "Open folder" can work before completion
  const earlyPath = safeJoin(started.dest_dir, started.file_name);
  if (earlyPath) refs.path = earlyPath;
  // context menu on right click
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.pageX, e.pageY, refs);
  });

  return refs;
}

function updateProgress(payload: ProgressPayload) {
  const refs = rows.get(payload.id);
  if (!refs) return;
  // speed
  refs.lastSpeed = payload.speed;
  refs.speed.textContent = formatSpeed(payload.speed);
  // size
  if (payload.total > 0) {
    refs.size.textContent = `${formatBytes(payload.received)} / ${formatBytes(payload.total)}`;
  } else {
    refs.size.textContent = formatBytes(payload.received);
  }
  // progress bar
  if (refs.bar && payload.total > 0) {
    const pct = Math.max(0, Math.min(100, Math.floor((payload.received / payload.total) * 100)));
    refs.bar.style.width = `${pct}%`;
    refs.status.querySelector('.progress')?.setAttribute('aria-valuenow', String(pct));
  }
  updateStatusBar();
}

function markCompleted(id: string, path: string) {
  const refs = rows.get(id);
  if (!refs) return;
  // status -> badge Finished
  refs.status.innerHTML = `<div class="badge" data-i18n="table.status.finished">${t('table.status.finished')}</div>`;
  // speed -> —
  refs.speed.textContent = '—';
  refs.lastSpeed = 0;
  refs.finished = true;
  refs.path = path;
  updateStatusBar();
  // persist
  const existing = loadHistory().find(h => h.id === id);
  upsertHistory({
    id,
    url: existing?.url || '',
    file_name: existing?.file_name || refs.name.textContent || 'download.bin',
    total: existing?.total ?? null,
    path,
    status: 'finished',
    created_at: existing?.created_at || Date.now(),
  });
}

function markFailed(id: string, _error: string) {
  const refs = rows.get(id);
  if (!refs) return;
  refs.status.innerHTML = `<div class="badge danger" data-i18n="table.status.failed">${t('table.status.failed')}</div>`;
  refs.speed.textContent = '—';
  // keep size as-is
  refs.lastSpeed = 0;
  refs.finished = true;
  updateStatusBar();
  // persist
  const existing = loadHistory().find(h => h.id === id);
  upsertHistory({
    id,
    url: existing?.url || '',
    file_name: existing?.file_name || refs.name.textContent || 'download.bin',
    total: existing?.total ?? null,
    path: existing?.path || refs.path,
    status: 'failed',
    created_at: existing?.created_at || Date.now(),
  });
}

let unlistenFns: UnlistenFn[] = [];

export async function initDownloadsUI() {
  // Render finished history first
  const hist = loadHistory().filter(h => h.status === 'finished' || h.status === 'failed');
  hist.forEach((h) => {
    const refs = createRow({ id: h.id, url: h.url, file_name: h.file_name, total: h.total, dest_dir: h.path ? undefined : undefined });
    rows.set(h.id, refs);
    if (h.status === 'finished' && h.path) {
      markCompleted(h.id, h.path);
    } else if (h.status === 'failed') {
      markFailed(h.id, '');
    }
  });

  // started
  unlistenFns.push(await listen<StartedPayload>('download_started', (e) => {
    const refs = createRow(e.payload);
    rows.set(e.payload.id, refs);
    updateStatusBar();
    // persist basic info
    upsertHistory({
      id: e.payload.id,
      url: e.payload.url,
      file_name: e.payload.file_name,
      total: e.payload.total,
      path: safeJoin(e.payload.dest_dir, e.payload.file_name),
      status: 'downloading',
      created_at: Date.now(),
    });
  }));
  // progress
  unlistenFns.push(await listen<ProgressPayload>('download_progress', (e) => updateProgress(e.payload)));
  // completed
  unlistenFns.push(await listen<CompletedPayload>('download_completed', (e) => markCompleted(e.payload.id, e.payload.path)));
  // failed
  unlistenFns.push(await listen<FailedPayload>('download_failed', (e) => markFailed(e.payload.id, e.payload.error)));
  // Note: canceled events are ignored in UI (no pause feature)
  // initialize status bar to current state
  updateStatusBar();
}

export function disposeDownloadsUI() {
  unlistenFns.forEach((fn) => fn());
  unlistenFns = [];
  rows.clear();
  updateStatusBar();
}

function updateStatusBar() {
  const items = rows.size;
  let active = 0;
  let totalSpeed = 0;
  rows.forEach((r) => {
    const isActive = !r.finished && !!(r.lastSpeed && r.lastSpeed > 0);
    if (isActive) active++;
    if (r.lastSpeed) totalSpeed += r.lastSpeed;
  });
  const root = document.querySelector('footer.statusbar');
  if (!root) return;
  const itemsEl = root.querySelector<HTMLElement>('[data-stat="items"]');
  const activeEl = root.querySelector<HTMLElement>('[data-stat="active"]');
  const totalEl = root.querySelector<HTMLElement>('[data-stat="total-speed"]');
  if (itemsEl) itemsEl.textContent = String(items);
  if (activeEl) activeEl.textContent = String(active);
  if (totalEl) totalEl.textContent = formatSpeed(totalSpeed);
}

function closeAnyMenu() {
  document.querySelectorAll('.ctx-menu').forEach((el) => el.remove());
}

function showContextMenu(x: number, y: number, refs: RowRefs) {
  closeAnyMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu portal';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const addOpt = (label: string, onClick: () => void, enabled: boolean) => {
    const opt = document.createElement('div');
    opt.className = 'ctx-item';
    opt.textContent = label;
    if (!enabled) opt.setAttribute('aria-disabled', 'true');
    else opt.addEventListener('click', () => { onClick(); closeAnyMenu(); });
    menu.appendChild(opt);
  };

  const canOpen = !!refs.path && !!refs.finished;
  const canReveal = !!refs.path;

  addOpt(t('ctx.open'), () => { if (refs.path) void openPath(refs.path); }, canOpen);
  addOpt(t('ctx.openFolder'), () => { if (refs.path) void revealItemInDir(refs.path); }, canReveal);
  addOpt(t('ctx.delete'), () => {
    // delete backend (also cancels if running) then remove from UI
    void invoke('delete_download', { id: refs.id }).catch(console.error);
    refs.row.remove();
    rows.delete(refs.id);
    updateStatusBar();
    removeFromHistory(refs.id);
  }, true);

  document.body.appendChild(menu);

  const onDocClick = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) { closeAnyMenu(); cleanup(); }
  };
  const onEsc = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') { closeAnyMenu(); cleanup(); }
  };
  function cleanup() {
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onEsc, true);
  }
  document.addEventListener('mousedown', onDocClick, true);
  document.addEventListener('keydown', onEsc, true);
}
