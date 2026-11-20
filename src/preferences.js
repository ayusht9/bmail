import { userMessage } from './errors.js';
import { appearancePreference, fontFamilies, fontSizes } from './appearance.js';

export function preferencesView(theme, preferences, saving, error, escape, scheduleSection = '') {
  const appearance = appearancePreference();
  const options = (items, selected) => items.map(([value, label]) => `<option value="${value}" ${String(selected) === String(value) ? 'selected' : ''}>${label}</option>`).join('');
  const row = (id, label, description, control) => `<div class="preference-row"><div class="preference-copy"><label for="${id}">${label}</label><p id="${id}-hint">${description}</p></div>${control}</div>`;
  return `<section class="preferences-page" aria-labelledby="preferences-title">
    <header class="preferences-header"><h2 id="preferences-title">Preferences</h2><p>Make Bmail feel at home.</p></header>
    <div class="preferences-layout">
      <div class="preferences-general">
        <section class="preference-section" aria-labelledby="appearance-title">
          <header><h3 id="appearance-title">Appearance</h3><span class="preference-save-note">Changes apply immediately</span></header>
          ${row('theme-preference', 'Theme', 'Choose a look, or follow your Windows theme.', `<select id="theme-preference" aria-describedby="theme-preference-hint">${options([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], theme)}</select>`)}
          ${row('font-family-preference', 'Font', 'Used throughout Bmail and when reading email.', `<select id="font-family-preference" aria-describedby="font-family-preference-hint">${options(Object.entries(fontFamilies).map(([key, font]) => [key, font.label]), appearance.fontFamily)}</select>`)}
          ${row('font-size-preference', 'Font size', 'Adjust text for comfortable reading.', `<select id="font-size-preference" aria-describedby="font-size-preference-hint">${options(fontSizes.map(size => [size, `${size} px${size === 13 ? ' (default)' : ''}`]), appearance.fontSize)}</select>`)}
        </section>
        <section class="preference-section" aria-labelledby="reading-title">
          <header><h3 id="reading-title">Email reading</h3></header>
          ${row('email-image-preference', 'Email images', 'Remote images can let senders know when you open an email.', `<select id="email-image-preference" aria-describedby="email-image-preference-hint">${options([['hidden', 'Hide images'], ['embedded', 'Show embedded images only'], ['remote', 'Show embedded and remote HTTPS images']], appearance.imageMode)}</select>`)}
        </section>
        <section class="preference-section" aria-labelledby="window-title">
          <header><h3 id="window-title">Window behavior</h3></header>
          ${row('close-behavior', 'When I close Bmail', 'Keep Bmail available in the tray, or exit the app.', `<select id="close-behavior" aria-describedby="close-behavior-hint" ${!preferences || saving ? 'disabled' : ''}>${options([['tray', 'Keep running in the system tray'], ['quit', 'Quit Bmail']], preferences?.closeToTray === false ? 'quit' : 'tray')}</select>`)}
          <p class="preferences-status" role="status">${saving ? 'Saving preference…' : !preferences && !error ? 'Loading desktop preferences…' : ''}</p>
          ${error ? `<p class="preferences-error" role="alert">${escape(userMessage(error))} <button data-action="retry-preferences">Reload preferences</button></p>` : ''}
        </section>
      </div>
      ${scheduleSection ? `<aside class="preferences-backups" aria-label="Scheduled backup preferences">${scheduleSection}</aside>` : ''}
    </div>
  </section>`;
}
