import { getCurrentWindow } from '@tauri-apps/api/window';

function isTauriEnv(): boolean {
  // v1: __TAURI__, v2: __TAURI_INTERNALS__ exists. Safe heuristic:
  return typeof (window as any).__TAURI__ !== 'undefined' || typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
}

export function wireWindowControls(){
  const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;

  if (!isTauriEnv()) {
    // In browser preview, make buttons still give feedback
    const hint = () => console.warn('[AnyDM] Window controls require Tauri runtime. 请使用 "pnpm tauri dev" 运行桌面应用预览。');
    q('[data-win="min"]')?.addEventListener('click', hint);
    q('[data-win="max"]')?.addEventListener('click', hint);
    q('[data-win="close"]')?.addEventListener('click', hint);
    return;
  }

  const win = getCurrentWindow();
  q('[data-win="min"]')?.addEventListener('click', () => { void win.minimize(); });
  q('[data-win="max"]')?.addEventListener('click', async () => {
    try {
      // Tauri v2 supports toggleMaximize
      if (typeof (win as any).toggleMaximize === 'function') {
        await (win as any).toggleMaximize();
      } else if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } catch (e) {
      console.warn('toggle maximize failed', e);
    }
  });
  q('[data-win="close"]')?.addEventListener('click', () => { void win.close(); });
}
