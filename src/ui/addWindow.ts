import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emitTo } from '@tauri-apps/api/event';

function isTauriEnv(): boolean {
  return typeof (window as any).__TAURI__ !== 'undefined' || typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
}

export async function openAddWindow(initialUrl?: string): Promise<void> {
  if (!isTauriEnv()) {
    const url = initialUrl ? `add.html?url=${encodeURIComponent(initialUrl)}` : 'add.html';
    window.open(url, '_blank');
    return;
  }

  const existing = await WebviewWindow.getByLabel('add');
  if (existing) {
    try { await (existing as any).unminimize?.(); } catch {}
    try { await existing.show(); } catch {}
    try { await existing.setFocus(); } catch {}
    if (initialUrl) {
      try { await emitTo('add', 'adm-prefill-url', initialUrl); } catch {}
    }
    return;
  }

  let posX: number | undefined;
  let posY: number | undefined;
  const targetWidth = 760;
  const targetHeight = 340;
  try {
    const main = getCurrentWindow();
    const [outerPos, outerSize, scaleFactor] = await Promise.all([
      (main as any).outerPosition?.(),
      (main as any).outerSize?.(),
      (main as any).scaleFactor?.() ?? Promise.resolve(1),
    ]);

    if (outerPos && outerSize) {
      const scale = typeof scaleFactor === 'number' && Number.isFinite(scaleFactor) ? scaleFactor : 1;
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
  const win = new WebviewWindow('add', {
    url: initialUrl ? `add.html?url=${encodeURIComponent(initialUrl)}` : 'add.html',
    title: '添加下载',
    width: targetWidth,
    height: targetHeight,
    resizable: false,
    decorations: false,
    visible: true,
    ...(posX !== undefined && posY !== undefined ? { x: posX, y: posY } : { center: true }),
  })
}
