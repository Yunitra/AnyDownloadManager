import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';

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
    try { await (existing as any).unminimize?.(); } catch {}
    try { await existing.show(); } catch {}
    try { await existing.setFocus(); } catch {}
    return;
  }

  // 计算主窗口中心点，让设置窗口相对主窗口居中
  let posX: number | undefined;
  let posY: number | undefined;
  const targetWidth = 960;
  const targetHeight = 640;
  try {
    const main = getCurrentWindow();
    const [outerPos, outerSize, scaleFactor] = await Promise.all([
      (main as any).outerPosition?.(),
      (main as any).outerSize?.(),
      (main as any).scaleFactor?.() ?? Promise.resolve(1),
    ]);

    if (outerPos && outerSize) {
      const scale = typeof scaleFactor === 'number' && Number.isFinite(scaleFactor) ? scaleFactor : 1;
      // outerPosition/outerSize 为物理像素，创建窗口的 x/y、width/height 为逻辑像素
      const logicalPosX = outerPos.x / scale;
      const logicalPosY = outerPos.y / scale;
      const logicalOuterWidth = outerSize.width / scale;
      const logicalOuterHeight = outerSize.height / scale;

      const mainCenterX = logicalPosX + logicalOuterWidth / 2;
      const mainCenterY = logicalPosY + logicalOuterHeight / 2;
      posX = Math.max(0, Math.floor(mainCenterX - targetWidth / 2));
      posY = Math.max(0, Math.floor(mainCenterY - targetHeight / 2));
    }
  } catch (error) {
    console.warn('Failed to calculate window position:', error);
  }
  
  // @ts-ignore
  const win = new WebviewWindow('settings', {
    url: '/settings.html',
    title: '设置',
    width: targetWidth,
    height: targetHeight,
    resizable: true,
    decorations: false,
    visible: true,
    ...(posX !== undefined && posY !== undefined ? { x: posX, y: posY } : { center: true }),
    // 不设置 parent，确保在任务栏显示为独立窗口
  });
}