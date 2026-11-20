import { userMessage } from './errors.js';
import { appearancePreference, fontFamilies, fontSizes } from './appearance.js';

export function preferencesView(theme, preferences, saving, error, escape, scheduleSection = '', cloudSection = '') {
  const appearance = appearancePreference();
  const options = (items, selected) => items.map(([value, label]) => `<option value="${value}" ${String(selected) === String(value) ? 'selected' : ''}>${label}</option>`).join('');
  const row = (id, label, control) => `<div class="preference-row"><label for="${id}">${label}</label>${control}</div>`;
  return `<section class="preferences-page" aria-labelledby="preferences-title">
    <header class="preferences-header"><h2 id="preferences-title">Preferences</h2></header>
    <div class="preferences-layout">
      <div class="preferences-general">
        <section class="preference-section" aria-labelledby="appearance-title">
          <header><h3 id="appearance-title">Appearance</h3></header>
          ${row('theme-preference', 'Theme', `<select id="theme-preference">${options([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], theme)}</select>`)}
          ${row('font-family-preference', 'Font', `<select id="font-family-preference">${options(Object.entries(fontFamilies).map(([key, font]) => [key, font.label]), appearance.fontFamily)}</select>`)}
          ${row('font-size-preference', 'Font size', `<select id="font-size-preference">${options(fontSizes.map(size => [size, `${size} px${size === 13 ? ' (default)' : ''}`]), appearance.fontSize)}</select>`)}
        </section>
        <section class="preference-section" aria-labelledby="reading-title">
          <header><h3 id="reading-title">Email reading</h3></header>
          ${row('email-image-preference', 'Email images', `<select id="email-image-preference">${options([['hidden', 'Hide images'], ['embedded', 'Embedded images only'], ['remote', 'Embedded and remote HTTPS images']], appearance.imageMode)}</select>`)}
        </section>
        <section class="preference-section" aria-labelledby="window-title">
          <header><h3 id="window-title">Window behavior</h3></header>
          ${row('close-behavior', 'When I close Bmail', `<select id="close-behavior" ${!preferences || saving ? 'disabled' : ''}>${options([['tray', 'Keep running in the system tray'], ['quit', 'Quit Bmail']], preferences?.closeToTray === false ? 'quit' : 'tray')}</select>`)}
          <p class="preferences-status" role="status">${saving ? 'Saving…' : !preferences && !error ? 'Loading…' : ''}</p>
          ${error ? `<p class="preferences-error" role="alert">${escape(userMessage(error))} <button data-action="retry-preferences">Reload preferences</button></p>` : ''}
        </section>
        ${cloudSection ? `<section class="preference-section cloud-backup-group" aria-labelledby="cloud-backup-title"><header><h3 id="cloud-backup-title">Cloud backup</h3></header><div class="cloud-providers">${cloudSection}</div></section>` : ''}
      </div>
      ${scheduleSection ? `<aside class="preferences-backups" aria-label="Scheduled backup preferences">${scheduleSection}</aside>` : ''}
    </div>
  </section>`;
}
