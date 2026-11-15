const key = 'bmail-theme';
const system = window.matchMedia('(prefers-color-scheme: dark)');
let preference = 'auto';
try { preference = localStorage.getItem(key) || 'auto'; } catch { /* Storage can be unavailable. */ }
if (!['auto', 'light', 'dark'].includes(preference)) preference = 'auto';

function apply() {
  const theme = preference === 'auto' ? system.matches ? 'dark' : 'light' : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1b2028' : '#e8ecf1');
}

export const themePreference = () => preference;
export function setTheme(value) {
  if (!['auto', 'light', 'dark'].includes(value)) return;
  preference = value;
  try { localStorage.setItem(key, value); } catch { /* Keep the current session preference. */ }
  apply();
}
system.addEventListener('change', () => { if (preference === 'auto') apply(); });
apply();
