import './styles/index.css';
import { initMicroInteractions } from './ui/microinteractions';
import { wireWindowControls } from './ui/windowControls';
import settingsHtml from './components/settings.html?raw';
import { initSettingsUI, applyThemeToDocument, getSavedTheme } from './ui/settings';
import { initI18n } from './ui/i18n';

(function mount(){
  const app = document.createElement('div');
  app.className = 'app-shell fade-in';
  app.innerHTML = settingsHtml;
  document.body.appendChild(app);
  // 初始化国际化并应用到整个文档
  initI18n(document);
  applyThemeToDocument(getSavedTheme());
  initMicroInteractions();
  wireWindowControls();
  initSettingsUI();
})();


