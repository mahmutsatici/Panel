// ============ Çizgi simgeleri ============
// Üst çubuktaki sayfa simgeleriyle aynı biçim (24×24, ince çizgi, currentColor). Emoji yerine arayüzde bunlar kullanılır:
//   ico('clock') → <svg class="ico ico-clock">…</svg>   (boyut yazı boyuyla aynıdır; CSS'te .ico-clock { … } ile ayarlanır)
const ICON_PATHS = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  flag: '<path d="M6 21V4.5M6 5h11l-2 3.5 2 3.5H6"/>',
  repeat: '<path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H18l-2.5-2.5M20 13v1.5A2.5 2.5 0 0 1 17.5 17H6l2.5 2.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  'chev-l': '<path d="M14.5 6l-6 6 6 6"/>',
  'chev-r': '<path d="M9.5 6l6 6-6 6"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5.5M14 11v5.5"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
  'chev-d': '<path d="M7 10l5 5 5-5"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.8a3 3 0 0 1 0 5.4M17.5 19a5.5 5.5 0 0 0-2.7-4.7"/>',
  list: '<path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5M11 7h9M11 13h9M11 19h9"/>',
};
const ico = (name, cls = '') => `<svg class="ico ico-${name}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
