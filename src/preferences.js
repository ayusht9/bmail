import { userMessage } from './errors.js';
import { appearancePreference, fontFamilies, fontSizes } from './appearance.js';

export function preferencesView(theme, preferences, saving, error, escape, scheduleSection = '') {
  const appearance = appearancePreference();
  return `<section class="preferences-page" aria-labelledby="preferences-title">
    <h2 id="preferences-title">Preferences</h2>
    <h3>Appearance</h3>
    <label for="theme-preference">Theme</label>
    <select id="theme-preference">${[['auto','Auto'],['light','Light'],['dark','Dark']].map(([value, label]) => `<option value="${value}" ${theme === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <label for="font-family-preference">Font</label>
    <select id="font-family-preference">${Object.entries(fontFamilies).map(([key, font]) => `<option value="${key}" ${appearance.fontFamily === key ? 'selected' : ''}>${font.label}</option>`).join('')}</select>
    <label for="font-size-preference">Font size</label>
    <select id="font-size-preference">${fontSizes.map(size => `<option value="${size}" ${appearance.fontSize === size ? 'selected' : ''}>${size} px${size === 13 ? ' (default)' : ''}</option>`).join('')}</select>
    <h3>Email reading</h3>
    <label for="email-image-preference">Email images</label>
    <select id="email-image-preference">${[['hidden', 'Hide images'], ['embedded', 'Show embedded images only'], ['remote', 'Show embedded and remote HTTPS images']].map(([value, label]) => `<option value="${value}" ${appearance.imageMode === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <h3>Window behavior</h3>
    <label for="close-behavior">When I close Bmail</label>
    <select id="close-behavior" ${!preferences || saving ? 'disabled' : ''}>
      <option value="tray" ${preferences?.closeToTray !== false ? 'selected' : ''}>Keep running in the system tray</option>
      <option value="quit" ${preferences?.closeToTray === false ? 'selected' : ''}>Quit Bmail</option>
    </select>
    <p class="preferences-status" role="status">${saving ? 'Saving preference…' : !preferences && !error ? 'Loading desktop preferences…' : ''}</p>
    ${error ? `<p class="preferences-error" role="alert">${escape(userMessage(error))} <button data-action="retry-preferences">Reload preferences</button></p>` : ''}
    ${scheduleSection}
  </section>`;
}
