import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

function isTauriEnv(): boolean {
  return typeof (window as any).__TAURI__ !== 'undefined' || typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
}

export async function openSettingsWindow(): Promise<void> {
  if (!isTauriEnv()) {
    // 浏览器预览时，直接在同页打开新的标签来模拟
    window.open('/settings.html', '_blank');
    return;
  }

  const existing = await WebviewWindow.getByLabel('settings');
  if (existing) {
    // 若此前用同标签打开过错误页面（index.html），强制关闭并重新创建
    try { await existing.close(); } catch {}
  }

  const mainWindow = getCurrentWebviewWindow();
  const win = new WebviewWindow('settings', {
    url: '/settings.html',
    title: '设置',
    width: 960,
    height: 640,
    resizable: true,
    decorations: false,
    visible: true,
    center: true,
    parent: mainWindow,
  });

  // Ignore unhandled promise rejections from listeners
  win.once('tauri://error', (e) => { console.warn('Settings window error', e); });
}


