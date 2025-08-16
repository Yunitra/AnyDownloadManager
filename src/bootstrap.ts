import header from './components/header.html?raw';
import sidebar from './components/sidebar.html?raw';
import toolbar from './components/toolbar.html?raw';
import table from './components/table.html?raw';
import statusbar from './components/statusbar.html?raw';
import { initMicroInteractions } from './ui/microinteractions';
import { wireWindowControls } from './ui/windowControls';
import { openSettingsWindow } from './ui/settingsWindow';
import { applyThemeToDocument, getSavedTheme } from './ui/settings';
import { initI18n } from './ui/i18n';
import { openAddWindow } from './ui/addWindow';
import { initDownloadsUI } from './ui/downloads';
// Deep link listener
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { listen } from '@tauri-apps/api/event';

(function mount(){
  const app = document.createElement('div');
  app.className = 'app-shell fade-in';
  app.innerHTML = `${header}
    <main class="app-main">
      ${sidebar}
      <section class="content-area">
        ${toolbar}
        ${table}
      </section>
    </main>
    ${statusbar}`;
  document.body.appendChild(app);
  // 应用文案国际化
  initI18n(document);
  // 应用主题
  applyThemeToDocument(getSavedTheme());
  initMicroInteractions();
  wireWindowControls();
  // 初始化下载事件监听，实时更新下载列表
  void initDownloadsUI();
  // 绑定设置按钮
  document.querySelector('[data-action="open-settings"]')?.addEventListener('click', () => { void openSettingsWindow(); });
  // 绑定添加链接（打开独立窗口）
  document.querySelector('[data-action="add-url"]')?.addEventListener('click', () => {
    void openAddWindow();
  });
  // 跨窗口同步主题：localStorage 变更将触发 storage 事件
  window.addEventListener('storage', (e) => {
    if (e.key === 'adm.theme' && e.newValue) {
      applyThemeToDocument(e.newValue as any);
    }
  });
  // 禁用默认右键菜单（使用自定义菜单）
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  }, { capture: true });

  // 监听系统深链，例如 adm://add?url=...
  try {
    void onOpenUrl(async (urls: string[]) => {
      // urls: string[]
      for (const u of urls) {
        try {
          const parsed = new URL(u);
          if (parsed.protocol === 'adm:' && parsed.host === 'add') {
            const link = parsed.searchParams.get('url') || '';
            if (link) {
              await openAddWindow(link);
              break;
            }
          }
        } catch {}
      }
    });
  } catch {}

  // 监听本地 HTTP Bridge 事件，从浏览器扩展无提示地接收 URL
  try {
    void listen<string>('adm-bridge-add-url', async (event) => {
      const link = event.payload;
      if (link) {
        await openAddWindow(link);
      }
    });
  } catch {}
})();
