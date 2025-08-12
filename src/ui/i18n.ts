type Lang = 'en' | 'zh-CN';

type Dict = Record<string, string>;

const dicts: Record<Lang, Dict> = {
  en: {
    'title.main': 'Any Download Manager',
    'title.settings': 'Settings',

    'header.menu.file': 'File',
    'header.menu.tasks': 'Tasks',
    'header.menu.tools': 'Tools',
    'header.menu.help': 'Help',

    'search.placeholder': 'Search in the list...',
    'search.aria': 'Search',

    'win.min': 'Minimize',
    'win.max': 'Maximize',
    'win.close': 'Close',

    'sidebar.group.all': 'All',
    'sidebar.group.types': 'Types',
    'sidebar.group.status': 'Status',
    'sidebar.btn.all': 'All',
    'sidebar.btn.image': 'Image',
    'sidebar.btn.music': 'Music',
    'sidebar.btn.video': 'Video',
    'sidebar.btn.apps': 'Apps',
    'sidebar.btn.document': 'Document',
    'sidebar.btn.compressed': 'Compressed',
    'sidebar.btn.other': 'Other',
    'sidebar.btn.finished': 'Finished',
    'sidebar.btn.unfinished': 'Unfinished',

    'toolbar.addUrl': 'Add URL',
    'toolbar.startQueue': 'Start Queue',
    'toolbar.stopQueue': 'Stop Queue',
    'toolbar.stopAll': 'Stop All',
    'toolbar.settings': 'Settings',

    'table.aria': 'Downloads',
    'table.h.name': 'Name',
    'table.h.size': 'Size',
    'table.h.status': 'Status',
    'table.h.speed': 'Speed',
    'table.h.dateAdded': 'Date Added',
    'table.progress': 'Progress',
    'table.status.finished': 'Finished',

    'settings.header': 'Settings',
    'settings.cat.appearance': 'Appearance',
    'settings.cat.engine': 'Download Engine',
    'settings.cat.extensions': 'Browser Extensions',

    'settings.theme.label': 'Theme',
    'settings.theme.help': 'Choose the app theme',
    'settings.theme.system': 'System',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',

    'settings.lang.label': 'Language',
    'settings.lang.help': 'Set the interface language',
    'settings.lang.system': 'System',

    'a11y.select': 'Select',
    'status.items': 'Items',
    'status.active': 'Active',
    'status.total': 'Total',
  },
  'zh-CN': {
    'title.main': 'Any Download Manager',
    'title.settings': '设置',

    'header.menu.file': '文件',
    'header.menu.tasks': '任务',
    'header.menu.tools': '工具',
    'header.menu.help': '帮助',

    'search.placeholder': '在列表内搜索...',
    'search.aria': '搜索',

    'win.min': '最小化',
    'win.max': '最大化',
    'win.close': '关闭',

    'sidebar.group.all': '全部',
    'sidebar.group.types': '类型',
    'sidebar.group.status': '状态',
    'sidebar.btn.all': '全部',
    'sidebar.btn.image': '图片',
    'sidebar.btn.music': '音乐',
    'sidebar.btn.video': '视频',
    'sidebar.btn.apps': '应用',
    'sidebar.btn.document': '文档',
    'sidebar.btn.compressed': '压缩包',
    'sidebar.btn.other': '其他',
    'sidebar.btn.finished': '已完成',
    'sidebar.btn.unfinished': '未完成',

    'toolbar.addUrl': '添加链接',
    'toolbar.startQueue': '开始队列',
    'toolbar.stopQueue': '停止队列',
    'toolbar.stopAll': '全部停止',
    'toolbar.settings': '设置',

    'table.aria': '下载列表',
    'table.h.name': '名称',
    'table.h.size': '大小',
    'table.h.status': '状态',
    'table.h.speed': '速度',
    'table.h.dateAdded': '添加时间',
    'table.progress': '进度',
    'table.status.finished': '已完成',

    'settings.header': '设置',
    'settings.cat.appearance': '外观',
    'settings.cat.engine': '下载引擎',
    'settings.cat.extensions': '浏览器插件集成',

    'settings.theme.label': '主题',
    'settings.theme.help': '选择应用主题',
    'settings.theme.system': '跟随系统',
    'settings.theme.light': '浅色模式',
    'settings.theme.dark': '深色模式',

    'settings.lang.label': '语言',
    'settings.lang.help': '设置界面语言',
    'settings.lang.system': '跟随系统',

    'a11y.select': '选择',
    'status.items': '项目',
    'status.active': '活动',
    'status.total': '总计',
  },
};

const STORAGE_KEY_LANG = 'adm.lang';

function systemLang(): Lang {
  const nav = navigator?.language || navigator?.languages?.[0] || 'en';
  return nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function getSavedLang(): 'system' | Lang {
  return (localStorage.getItem(STORAGE_KEY_LANG) as any) || 'system';
}

export function resolveLang(): Lang {
  const saved = getSavedLang();
  return saved === 'system' ? systemLang() : saved;
}

export function setLang(lang: 'system' | Lang): void {
  localStorage.setItem(STORAGE_KEY_LANG, lang);
  // Broadcast change within this window
  try {
    const ce = new CustomEvent('adm:lang-changed', { detail: { lang } });
    window.dispatchEvent(ce);
  } catch {}
}

export function t(key: string): string {
  const lang = resolveLang();
  return dicts[lang][key] ?? key;
}

// Format relative time like "22 hours ago" respecting current language
function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  try {
    const rtf = new Intl.RelativeTimeFormat(resolveLang(), { numeric: 'auto' });
    return rtf.format(value, unit);
  } catch {
    // Fallback simple formatting in case Intl is unavailable
    const abs = Math.abs(value);
    const suffix = value < 0 ? (resolveLang() === 'zh-CN' ? '前' : ' ago') : (resolveLang() === 'zh-CN' ? '后' : ' later');
    const unitMap: Record<string, string> = resolveLang() === 'zh-CN' ? {
      second: '秒', seconds: '秒', minute: '分钟', minutes: '分钟', hour: '小时', hours: '小时', day: '天', days: '天'
    } : {
      second: 'second', seconds: 'seconds', minute: 'minute', minutes: 'minutes', hour: 'hour', hours: 'hours', day: 'day', days: 'days'
    };
    const key = abs === 1 ? unit : (unit + 's');
    return `${abs} ${unitMap[key] || unit}${suffix}`;
  }
}

// Apply relative time formatting for elements with data-rel-time and data-rel-unit
function applyRelativeTimes(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-rel-time][data-rel-unit]').forEach((el) => {
    const raw = el.getAttribute('data-rel-time');
    const unit = el.getAttribute('data-rel-unit') as Intl.RelativeTimeFormatUnit | null;
    if (!raw || !unit) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    el.textContent = formatRelativeTime(value, unit);
  });
}

function setDocumentLangAttr(): void {
  document.documentElement.lang = resolveLang();
}

export function applyI18n(root: ParentNode = document): void {
  // Translate text content
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')!;
    el.textContent = t(key);
  });
  // Translate attributes
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    const mapping = el.getAttribute('data-i18n-attr')!; // e.g. "placeholder:search.placeholder,aria-label:search.aria"
    mapping.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
  // Translate <title>
  const titleEl = document.querySelector('head > title[data-i18n]') as HTMLTitleElement | null;
  if (titleEl) {
    const key = titleEl.getAttribute('data-i18n')!;
    titleEl.textContent = t(key);
  }
  // Relative time labels
  applyRelativeTimes(root);
  setDocumentLangAttr();
}

export function initI18n(root: ParentNode = document): void {
  applyI18n(root);
  // Re-apply when language changes within this window
  window.addEventListener('adm:lang-changed', () => applyI18n(root));
  // Re-apply when another window changes localStorage
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY_LANG) applyI18n(root);
  });
}
