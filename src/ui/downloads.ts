import { listen, UnlistenFn } from '@tauri-apps/api/event';
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

  const colSelect = document.createElement('div');
  colSelect.innerHTML = `<input type="checkbox" data-i18n-attr="aria-label:a11y.select" aria-label="${t('a11y.select')}"/>`;

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

  row.appendChild(colSelect);
  row.appendChild(colName);
  row.appendChild(colSize);
  row.appendChild(colStatus);
  row.appendChild(colSpeed);
  row.appendChild(colDate);

  table.appendChild(row);
  applyI18n(row);

  return { row, name: colName, size: colSize, status: colStatus, speed: colSpeed, date: colDate, bar };
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

function markCompleted(id: string, _path: string) {
  const refs = rows.get(id);
  if (!refs) return;
  // status -> badge Finished
  refs.status.innerHTML = `<div class="badge" data-i18n="table.status.finished">${t('table.status.finished')}</div>`;
  // speed -> —
  refs.speed.textContent = '—';
  refs.lastSpeed = 0;
  refs.finished = true;
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
