import { appearancePreference, fontFamilies, fontSizes } from './appearance.js';

export function preferencesView(theme, preferences, saving, error, escape) {
  const appearance = appearancePreference();
  return `<section class="preferences-page" aria-labelledby="preferences-title">
    <h2 id="preferences-title">Preferences</h2>
    <h3>Appearance</h3>
    <label for="theme-preference">Theme</label>
    <select id="theme-preference" aria-describedby="theme-description">${[['auto','Auto'],['light','Light'],['dark','Dark']].map(([value, label]) => `<option value="${value}" ${theme === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <p id="theme-description">Auto follows your Windows appearance. Your choice is saved on this device.</p>
    <label for="font-family-preference">Font</label>
    <select id="font-family-preference">${Object.entries(fontFamilies).map(([key, font]) => `<option value="${key}" ${appearance.fontFamily === key ? 'selected' : ''}>${font.label}</option>`).join('')}</select>
    <label for="font-size-preference">Font size</label>
    <select id="font-size-preference" aria-describedby="font-description">${fontSizes.map(size => `<option value="${size}" ${appearance.fontSize === size ? 'selected' : ''}>${size} px${size === 13 ? ' (default)' : ''}</option>`).join('')}</select>
    <p id="font-description">Updates the interface and default email reading text immediately. Saved on this device.</p>
    <h3>Email reading</h3>
    <label for="email-image-preference">Email images</label>
    <select id="email-image-preference" aria-describedby="email-image-description">${[['hidden', 'Hide images'], ['embedded', 'Show embedded images only'], ['remote', 'Show embedded and remote HTTPS images']].map(([value, label]) => `<option value="${value}" ${appearance.imageMode === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <p id="email-image-description">Embedded images are included in the saved message. Showing remote images can contact the sender's servers. Your choice is saved on this device.</p>
    <h3>Window behavior</h3>
    <label for="close-behavior">When I close Bmail</label>
    <select id="close-behavior" aria-describedby="close-description" ${!preferences || saving ? 'disabled' : ''}>
      <option value="tray" ${preferences?.closeToTray !== false ? 'selected' : ''}>Keep running in the system tray</option>
      <option value="quit" ${preferences?.closeToTray === false ? 'selected' : ''}>Quit Bmail</option>
    </select>
    <p id="close-description">${preferences?.closeToTray === false ? 'Closing the window quits Bmail.' : 'Closing the window hides Bmail. Click its system tray icon to reopen it, or right-click the icon and choose Quit Bmail.'} Backups already running continue independently.</p>
    <p class="preferences-status" role="status">${saving ? 'Saving preference…' : !preferences && !error ? 'Loading desktop preferences…' : ''}</p>
    ${error ? `<p class="preferences-error" role="alert">${escape(error)} <button data-action="retry-preferences">Reload preferences</button></p>` : ''}
  </section>`;
}
