const s = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS = {
  copy: s('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
  paste: s('<rect x="5" y="5" width="14" height="16" rx="1.5"/><path d="M9 5V3.8c0-.4.4-.8.8-.8h4.4c.4 0 .8.4.8.8V5"/><path d="M9 11h6M9 15h6"/>'),
  duplicate: s('<rect x="4" y="4" width="11" height="11" rx="1.5"/><path d="M9 20h9.5a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 7v5M7 9.5h5"/>'),
  delete: s('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5A1.6 1.6 0 0 0 8.6 21h6.8a1.6 1.6 0 0 0 1.6-1.5L18 7"/><path d="M9 7V4.5c0-.3.2-.5.5-.5h5c.3 0 .5.2.5.5V7"/>'),
  undo: s('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: s('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  showAll: s('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
  group: s('<path d="M4 4h10v5h6v11H9v-5H4z"/>'),
  ungroup: s('<rect x="3.5" y="3.5" width="9" height="9" rx="1"/><rect x="11.5" y="11.5" width="9" height="9" rx="1" stroke-dasharray="2.2 2"/>'),
  align: s('<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="8" height="4" rx="1"/>'),
  mirror: s('<path d="M12 3v18" stroke-dasharray="2 2.2"/><path d="M9 7L3 17h6z"/><path d="M15 7l6 10h-6z"/>'),
  lock: s('<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>'),
  unlock: s('<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7.5a4 4 0 0 1 7.7-1.5"/>'),
  bulb: s('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
  home: s('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>'),
  fit: s('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  minus: s('<path d="M5 12h14"/>'),
  cube: s('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  cubeOrtho: s('<rect x="5" y="5" width="14" height="14"/><path d="M5 5l3-2h14l-3 2M19 19l3-2V3"/>'),
  grid: s('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>'),
  search: s('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>', 'width="16" height="16"'),
  chevron: s('<path d="M6 9l6 6 6-6"/>', 'width="16" height="16"'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>', 'width="18" height="18"'),
};
