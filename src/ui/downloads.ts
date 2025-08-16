import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener';
import { applyI18n, t } from './i18n';

interface StartedPayload {
  id: string;
  url: string;
  file_name: string;
  total: number | null;
}
interface ProgressPayload {
  id: string;
  received: number;
  total: number;
  speed: number;
}
interface CompletedPayload { id: string; path: string }
interface FailedPayload { id: string; error: string }
interface CanceledPayload { id: string }

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
  paused?: boolean;
  id: string;
  path?: string;
};

const rows = new Map<string, RowRefs>();
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
  if (refs.paused) return; // don't update UI while paused
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
  refs.paused = false;
  refs.path = path;
  updateStatusBar();
}

function markFailed(id: string, _error: string) {
  const refs = rows.get(id);
  if (!refs) return;
  refs.status.innerHTML = `<div class="badge danger" data-i18n="table.status.failed">${t('table.status.failed')}</div>`;
  refs.speed.textContent = '—';
  // keep size as-is
  refs.lastSpeed = 0;
  refs.finished = true;
  refs.paused = false;
  updateStatusBar();
}

let unlistenFns: UnlistenFn[] = [];

export async function initDownloadsUI() {
  // started
  unlistenFns.push(await listen<StartedPayload>('download_started', (e) => {
    const refs = createRow(e.payload);
    rows.set(e.payload.id, refs);
    updateStatusBar();
  }));
  // progress
  unlistenFns.push(await listen<ProgressPayload>('download_progress', (e) => updateProgress(e.payload)));
  // completed
  unlistenFns.push(await listen<CompletedPayload>('download_completed', (e) => markCompleted(e.payload.id, e.payload.path)));
  // failed
  unlistenFns.push(await listen<FailedPayload>('download_failed', (e) => markFailed(e.payload.id, e.payload.error)));
  // canceled -> mark as paused in UI
  unlistenFns.push(await listen<CanceledPayload>('download_canceled', (e) => {
    const refs = rows.get(e.payload.id);
    if (!refs) return;
    refs.paused = true;
    refs.speed.textContent = '—';
    refs.lastSpeed = 0;
    refs.status.innerHTML = `<div class="badge" data-i18n="table.status.paused">${t('table.status.paused')}</div>`;
    updateStatusBar();
  }));
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
    const isActive = !r.finished && !r.paused && !!(r.lastSpeed && r.lastSpeed > 0);
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
  document.querySelectorAll('.menu.portal[data-kind="context"]').forEach((el) => el.remove());
}

function showContextMenu(x: number, y: number, refs: RowRefs) {
  closeAnyMenu();
  const menu = document.createElement('div');
  menu.className = 'menu portal';
  menu.setAttribute('data-kind', 'context');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const addOpt = (label: string, onClick: () => void, enabled: boolean) => {
    const opt = document.createElement('div');
    opt.className = 'option';
    opt.textContent = label;
    if (!enabled) opt.setAttribute('aria-disabled', 'true');
    else opt.addEventListener('click', () => { onClick(); closeAnyMenu(); });
    menu.appendChild(opt);
  };

  const canOpen = !!refs.path && !!refs.finished;
  const canReveal = !!refs.path;
  const canPause = !Boolean(refs.finished) && !Boolean(refs.paused) && (refs.lastSpeed || 0) > 0;
  const canResume = !Boolean(refs.finished) && Boolean(refs.paused);

  addOpt(t('ctx.open'), () => { if (refs.path) void openPath(refs.path); }, canOpen);
  addOpt(t('ctx.openFolder'), () => { if (refs.path) void revealItemInDir(refs.path); }, canReveal);
  addOpt(t('ctx.resume'), () => {
    // request backend resume; only change UI on success
    invoke('resume_download', { id: refs.id, threads: 4 })
      .then(() => {
        refs.paused = false;
        if (refs.bar) {
          // keep progress bar
        } else if (!refs.finished) {
          refs.status.innerHTML = `<div class="badge" data-i18n="table.status.downloading">${t('table.status.downloading')}</div>`;
        }
        updateStatusBar();
      })
      .catch((err) => {
        console.error(err);
        // keep paused state
      });
  }, canResume);
  addOpt(t('ctx.pause'), () => {
    // request backend cancel to actually stop bandwidth
    void invoke('cancel_download', { id: refs.id }).catch(console.error);
    // UI will be updated via download_canceled listener
  }, canPause);
  addOpt(t('ctx.delete'), () => {
    // delete backend (also cancels if running) then remove from UI
    void invoke('delete_download', { id: refs.id }).catch(console.error);
    refs.row.remove();
    rows.delete(refs.id);
    updateStatusBar();
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
