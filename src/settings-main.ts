import './styles/index.css';
import { initMicroInteractions } from './ui/microinteractions';
import { wireWindowControls } from './ui/windowControls';
import settingsHtml from './components/settings.html?raw';
import { initSettingsUI, applyThemeToDocument, getSavedTheme } from './ui/settings';

(function mount(){
  const app = document.createElement('div');
  app.className = 'app-shell fade-in';
  app.innerHTML = settingsHtml;
  document.body.appendChild(app);
  applyThemeToDocument(getSavedTheme());
  initMicroInteractions();
  wireWindowControls();
  initSettingsUI();
})();


