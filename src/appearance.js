const storageKey = 'bmail-appearance';

export function normalizeAppearance(value = {}) {
  return { imageMode: ['hidden', 'embedded', 'remote'].includes(value?.imageMode) ? value.imageMode : 'embedded' };
}

let preferences;
try { preferences = normalizeAppearance(JSON.parse(localStorage.getItem(storageKey))); }
catch { preferences = normalizeAppearance(); }

export const appearancePreference = () => ({ ...preferences });
export function setAppearance(change) {
  preferences = normalizeAppearance({ ...preferences, ...change });
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Keep the session choice. */ }
}
