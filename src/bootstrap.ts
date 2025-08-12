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
  // 绑定设置按钮
  document.querySelector('[data-action="open-settings"]')?.addEventListener('click', () => { void openSettingsWindow(); });
  // 跨窗口同步主题：localStorage 变更将触发 storage 事件
  window.addEventListener('storage', (e) => {
    if (e.key === 'adm.theme' && e.newValue) {
      applyThemeToDocument(e.newValue as any);
    }
  });
})();
