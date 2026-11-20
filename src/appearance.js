const storageKey = 'bmail-appearance';
export const fontFamilies = {
  system: { label: 'Segoe UI (default)', css: '"Segoe UI", Tahoma, sans-serif' },
  arial: { label: 'Arial', css: 'Arial, sans-serif' },
  calibri: { label: 'Calibri', css: 'Calibri, "Segoe UI", sans-serif' },
  georgia: { label: 'Georgia', css: 'Georgia, serif' },
  consolas: { label: 'Consolas', css: 'Consolas, monospace' },
};
export const fontSizes = [12, 13, 14, 15, 16, 18, 20];

export function normalizeAppearance(value = {}) {
  return {
    imageMode: ['hidden', 'embedded', 'remote'].includes(value?.imageMode) ? value.imageMode : 'embedded',
    fontFamily: Object.hasOwn(fontFamilies, value?.fontFamily) ? value.fontFamily : 'system',
    fontSize: fontSizes.includes(Number(value?.fontSize)) ? Number(value.fontSize) : 13,
  };
}

let preferences;
try { preferences = normalizeAppearance(JSON.parse(localStorage.getItem(storageKey))); }
catch { preferences = normalizeAppearance(); }

function apply() {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  style.fontFamily = fontFamilies[preferences.fontFamily].css;
  style.fontSize = `${preferences.fontSize}px`;
  style.setProperty('--app-font-family', fontFamilies[preferences.fontFamily].css);
  style.setProperty('--app-font-scale', String(preferences.fontSize / 13));
}

export const appearancePreference = () => ({ ...preferences });
export function setAppearance(change) {
  preferences = normalizeAppearance({ ...preferences, ...change });
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Keep the session choice. */ }
  apply();
}
apply();
