const fullDateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'full' });
const monthFormatter = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
const clockFormatter = new Intl.DateTimeFormat('en-IN', { timeStyle: 'medium' });
export const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = value => new Date(`${value}T00:00:00`);
const ordinal = date => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
export const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function defaultSchedule(now = new Date()) {
  return { enabled: true, frequency: 'weekly', startDate: localDate(now), time: '11:00', weekdays: [1], monthDay: '1',
    intervalHours: 6, every: 1, endDate: null, startWhenAvailable: true, networkRequired: true, wakeComputer: false,
    allowOnBattery: true, stopOnBattery: false, maxRunHours: 48, restartCount: 0, restartMinutes: 15, allFolders: true, folders: [] };
}

export function normalizeSchedule(input, now = new Date()) {
  const s = { ...defaultSchedule(now), ...input };
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(parseDate(value).getTime()) && localDate(parseDate(value)) === value && parseDate(value).getFullYear() >= 1970;
  if (!['once', 'daily', 'weekly', 'monthly', 'interval'].includes(s.frequency)) throw new Error('Choose a recurrence.');
  if (!validDate(s.startDate) || s.endDate && !validDate(s.endDate)) throw new Error('Choose valid start and end dates.');
  if (s.endDate && s.endDate < s.startDate) throw new Error('The end date must not be before the start date.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new Error('Choose a valid time.');
  for (const [key, min, max] of [['every', 1, s.frequency === 'weekly' ? 52 : 365], ['intervalHours', 1, 24], ['maxRunHours', 1, 168], ['restartCount', 0, 10], ['restartMinutes', 1, 1440]]) {
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max) throw new Error(`Choose a valid ${key}.`);
  }
  for (const key of ['enabled', 'startWhenAvailable', 'networkRequired', 'wakeComputer', 'allowOnBattery', 'stopOnBattery', 'allFolders']) if (typeof s[key] !== 'boolean') throw new Error(`Choose a valid ${key}.`);
  if (!Array.isArray(s.folders) || s.folders.length > 1000 || s.folders.some(folder => typeof folder !== 'string' || !folder.trim() || folder.length > 1024)) throw new Error('Choose valid scheduled folders.');
  if (!s.allFolders && !s.folders.length) throw new Error('Choose at least one scheduled folder.');
  s.folders = s.allFolders ? [] : [...new Set(s.folders)];
  if (!Array.isArray(s.weekdays) || s.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Choose valid weekdays.');
  s.weekdays = [...new Set(s.weekdays)].sort();
  if (s.frequency === 'weekly' && !s.weekdays.length) throw new Error('Choose at least one weekday.');
  if (!/^(last|[1-9]|[12]\d|3[01])$/.test(String(s.monthDay))) throw new Error('Choose a day from 1 to 31, or the last day.');
  s.monthDay = String(s.monthDay);
  if (s.enabled && s.frequency === 'once' && new Date(`${s.startDate}T${s.time}`) <= now) throw new Error('Choose a future time for a one-time backup.');
  if (s.enabled && s.endDate && new Date(`${s.endDate}T23:59:59`) < now) throw new Error('The schedule end date has already passed.');
  return s;
}

// Calendar preview uses local wall-clock dates. Windows' reported nextRunTime is
// authoritative when daylight-saving changes, missed runs or conditions apply.
export function nextRuns(schedule, after = new Date(), count = 8, until = null) {
  if (!schedule.enabled) return [];
  const start = new Date(`${schedule.startDate}T${schedule.time}:00`);
  const end = schedule.endDate ? new Date(`${schedule.endDate}T23:59:59`) : null;
  const limit = until && (!end || until < end) ? until : end;
  const results = [];
  if (schedule.frequency === 'once' || schedule.frequency === 'interval') {
    const step = schedule.intervalHours * 3600000;
    let next = new Date(start);
    if (schedule.frequency === 'interval' && next <= after) next = new Date(start.getTime() + (Math.floor((after - start) / step) + 1) * step);
    while (next > after && (!limit || next <= limit) && results.length < count) {
      results.push(new Date(next));
      if (schedule.frequency === 'once') break;
      next = new Date(next.getTime() + step);
    }
    return results;
  }
  const day = parseDate(localDate(after > start ? after : start));
  const anchor = ordinal(parseDate(schedule.startDate));
  const weekAnchor = anchor - parseDate(schedule.startDate).getDay();
  for (let scanned = 0; scanned < 36600 && results.length < count; scanned++, day.setDate(day.getDate() + 1)) {
    const candidate = new Date(`${localDate(day)}T${schedule.time}:00`);
    if (limit && candidate > limit) break;
    if (candidate <= after || candidate < start) continue;
    const matches = schedule.frequency === 'daily' ? (ordinal(day) - anchor) % schedule.every === 0
      : schedule.frequency === 'weekly' ? schedule.weekdays.includes(day.getDay()) && Math.floor((ordinal(day) - weekAnchor) / 7) % schedule.every === 0
      : day.getDate() === (schedule.monthDay === 'last' ? new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate() : Number(schedule.monthDay));
    if (matches) results.push(candidate);
  }
  return results;
}

export function scheduleSummary(status, installed = false) {
  if (!status?.installed) return installed && !status ? 'Installed; open Scheduler for details' : 'Not installed';
  if (!status.enabled) return 'Paused';
  const s = status.settings;
  if (!s) return status.state || 'Installed';
  const recurrence = s.frequency === 'interval' ? `Every ${s.intervalHours} hours` : s.frequency === 'weekly' ? `${s.every > 1 ? `Every ${s.every} weeks: ` : ''}${s.weekdays.map(day => weekdayNames[day].slice(0, 3)).join(', ')}`
    : s.frequency === 'daily' ? s.every === 1 ? 'Daily' : `Every ${s.every} days` : s.frequency === 'monthly' ? `Monthly (${s.monthDay === 'last' ? 'last day' : `day ${s.monthDay}`})` : s.startDate;
  return `${recurrence} at ${s.time}`;
}

export const POWER_SETTINGS = ['startWhenAvailable', 'networkRequired', 'wakeComputer', 'allowOnBattery', 'stopOnBattery', 'maxRunHours', 'restartCount', 'restartMinutes'];

// Power, network and recovery settings live in Preferences. The scheduler form
// keeps whatever values the saved schedule already has.
export function powerSettings(source) {
  source ||= {};
  return Object.fromEntries(POWER_SETTINGS.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

export function powerFromForm(form) {
  const values = new FormData(form);
  const number = name => Number(form.elements.namedItem(name)?.value);
  return { startWhenAvailable: values.has('startWhenAvailable'), networkRequired: values.has('networkRequired'), wakeComputer: values.has('wakeComputer'),
    allowOnBattery: values.has('allowOnBattery'), stopOnBattery: values.has('stopOnBattery'),
    maxRunHours: number('maxRunHours'), restartCount: number('restartCount'), restartMinutes: number('restartMinutes') };
}

export function scheduleFromForm(form, saved = {}) {
  const value = name => form.elements.namedItem(name)?.value;
  const frequency = value('frequency');
  const weekdays = [...form.querySelectorAll('[name="weekdays"]:checked')].map(input => Number(input.value));
  return { enabled: Boolean(form.elements.namedItem('enabled')?.checked), frequency, startDate: value('startDate'), time: value('time'),
    weekdays: frequency === 'weekly' ? weekdays : weekdays.length ? weekdays : [1], monthDay: frequency === 'monthly' ? value('monthDay') : '1',
    every: ['daily','weekly'].includes(frequency) ? Number(value('every')) : 1, intervalHours: frequency === 'interval' ? Number(value('intervalHours')) : 6,
    endDate: value('endDate') || null, ...powerSettings(saved),
    allFolders: form.elements.scheduleAllFolders.checked,
    folders: [...form.querySelectorAll('[name="scheduledFolders"]:checked')].map(input => input.value) };
}

export function scheduleFolderChoices(dashboard, selected, disabled, escape) {
  const names = [...new Set([...(dashboard.mailboxes?.folders || []), ...(dashboard.localStats?.folders || []).map(folder => folder.name),
    ...(dashboard.mailboxStatus?.folders || []).map(folder => folder.name), ...selected])].sort();
  return `<fieldset id="schedule-folder-choices" ${disabled ? 'disabled' : ''}><legend class="sr-only">Scheduled folders</legend>${names.length ? names.map(name => `<label class="folder-choice"><input type="checkbox" name="scheduledFolders" value="${escape(name)}" ${selected.includes(name) ? 'checked' : ''}><span>${escape(name)}</span></label>`).join('') : '<p class="muted">No folders loaded.</p>'}</fieldset>`;
}

export function calendarMarkup(schedule, month, focusDate, escape, now = new Date()) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const from = new Date(first); from.setDate(1 - first.getDay());
  const until = new Date(from); until.setDate(until.getDate() + 42); until.setMilliseconds(-1);
  const dots = new Set(nextRuns(schedule, new Date(from.getTime() - 1), 1100, until).map(localDate));
  const today = localDate(now);
  const tabStop = focusDate && parseDate(focusDate).getMonth() === month.getMonth() && parseDate(focusDate).getFullYear() === month.getFullYear() ? focusDate : localDate(first);
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(from); date.setDate(from.getDate() + index); const iso = localDate(date);
    return `<td><button type="button" data-action="schedule-day" data-date="${iso}" tabindex="${iso === tabStop ? 0 : -1}" aria-label="${escape(fullDateFormatter.format(date))}" aria-pressed="${iso === schedule.startDate}" class="${date.getMonth() !== month.getMonth() ? 'outside ' : ''}${iso === today ? 'today ' : ''}${dots.has(iso) ? 'scheduled ' : ''}${iso === schedule.startDate ? 'chosen' : ''}">${date.getDate()}</button></td>`;
  });
  return `<div class="calendar-heading"><button type="button" data-action="schedule-prev" aria-label="Previous month">‹</button><strong>${escape(monthFormatter.format(first))}</strong><button type="button" data-action="schedule-next" aria-label="Next month">›</button></div>
    <table class="schedule-calendar" role="grid" aria-label="Schedule calendar"><thead><tr>${weekdayNames.map(day => `<th scope="col" abbr="${day}">${day.slice(0, 2)}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: 6 }, (_, row) => `<tr>${cells.slice(row * 7, row * 7 + 7).join('')}</tr>`).join('')}</tbody></table>`;
}

export function schedulerView(dashboard, escape, draft = null) {
  const s = { ...defaultSchedule(), ...dashboard.schedule?.settings, ...draft };
  const ticks = Array.from({ length: 60 }, (_, minute) => `<line class="tick${minute % 5 ? '' : ' hour'}" x1="50" y1="5" x2="50" y2="${minute % 5 ? 8 : 11}" transform="rotate(${minute * 6} 50 50)"/>`).join('');
  return `<section id="scheduler-panel" class="scheduler-page" aria-labelledby="scheduler-title"><form id="scheduler-form">
    <header class="scheduler-head"><h2 id="scheduler-title">Backup scheduler</h2><label class="toggle-control"><input type="checkbox" role="switch" name="enabled" ${s.enabled ? 'checked' : ''}><span class="toggle-track" aria-hidden="true"></span><span>Enable scheduled backups</span></label></header>
    <div class="scheduler-layout">
      <aside class="scheduler-calendar-pane">
        <div class="scheduler-clock"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="face" cx="50" cy="50" r="47"/>${ticks}<line id="clock-hour" x1="50" y1="53" x2="50" y2="27"/><line id="clock-minute" x1="50" y1="55" x2="50" y2="14"/><line id="clock-second" x1="50" y1="59" x2="50" y2="10"/><circle class="hub" cx="50" cy="50" r="2.4"/></svg>
          <div class="scheduler-clock-text"><time id="scheduler-clock" aria-label="Current local time"></time><small id="scheduler-zone"></small></div></div>
        <div id="schedule-calendar"></div>
      </aside>
      <section class="scheduler-fields" aria-label="Schedule settings">
        <section class="scheduler-card" aria-labelledby="schedule-when-title">
          <h3 id="schedule-when-title">When</h3>
          <div class="date-fields">
            <div><label for="schedule-frequency">Repeat</label><select id="schedule-frequency" name="frequency">${[['once','One time'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['interval','Every few hours']].map(([value,label]) => `<option value="${value}" ${s.frequency === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
            <div data-recurrence="daily weekly"><label for="schedule-every">Repeat every (days / weeks)</label><input id="schedule-every" name="every" type="number" min="1" max="365" value="${s.every}" required></div>
            <div data-recurrence="monthly"><label for="schedule-month-day">Day of month</label><select id="schedule-month-day" name="monthDay">${[...Array.from({ length: 31 }, (_, index) => String(index + 1)), 'last'].map(day => `<option value="${day}" ${s.monthDay === day ? 'selected' : ''}>${day === 'last' ? 'Last day' : day}</option>`).join('')}</select></div>
            <div data-recurrence="interval"><label for="schedule-hours">Interval (hours)</label><input id="schedule-hours" name="intervalHours" type="number" min="1" max="24" value="${s.intervalHours}" required></div>
            <div><label for="schedule-date">Start date</label><input id="schedule-date" name="startDate" type="date" value="${escape(s.startDate)}" required></div>
            <div><label for="schedule-time">Start time</label><input id="schedule-time" name="time" type="time" value="${escape(s.time)}" required></div>
            <div><label for="schedule-end">End date (optional)</label><input id="schedule-end" name="endDate" type="date" value="${escape(s.endDate || '')}"></div>
          </div>
          <fieldset data-recurrence="weekly" class="schedule-weekdays"><legend>Days of week</legend>${weekdayNames.map((day, index) => `<label><input type="checkbox" name="weekdays" value="${index}" ${s.weekdays.includes(index) ? 'checked' : ''}><span>${day.slice(0, 3)}</span></label>`).join('')}</fieldset>
        </section>
        <section class="scheduler-card scheduled-folder-selection" aria-labelledby="schedule-folders-title">
          <div class="backup-card-head"><h3 id="schedule-folders-title">Folders</h3><button type="button" class="ghost" data-action="schedule-load-folders" ${dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>Refresh folders</button></div>
          <label class="folder-choice"><input id="schedule-all-folders" type="checkbox" name="scheduleAllFolders" ${s.allFolders ? 'checked' : ''}>All mailbox folders</label>
          <div id="schedule-folder-options">${scheduleFolderChoices(dashboard, s.folders, s.allFolders, escape)}</div>
        </section>
        <div id="schedule-status" class="scheduler-card schedule-status" aria-live="polite"></div>
        <p id="schedule-error" role="alert"></p>
      </section>
    </div>
    <div class="dialog-actions"><button type="button" data-action="schedule-remove" ${dashboard.scheduleInstalled ? '' : 'disabled'}>Remove schedule</button><button type="button" data-action="schedule-read" ${!dashboard.credentialReady ? 'disabled' : ''}>Refresh status</button><button type="submit" class="primary" ${dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>Save schedule</button></div>
  </form></section>`;
}

const taskResults = { 0: 'Succeeded', 1: 'Failed', 267008: 'Ready', 267009: 'Running', 267010: 'Disabled', 267011: 'Not run yet', 267012: 'No more runs', 267014: 'Stopped', 267015: 'Not started' };

export function taskResult(code) {
  if (code == null || code === '') return '';
  const number = Number(code);
  return taskResults[number] || (Number.isFinite(number) ? `Error 0x${(number >>> 0).toString(16).toUpperCase()}` : String(code));
}

export function scheduleStatusMarkup(status, format, escape) {
  if (!status) return '<strong>Windows: Not loaded</strong>';
  const result = taskResult(status.lastResult);
  const row = (label, value) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`;
  return `<strong>Windows: ${escape(status.state)}</strong><dl>${row('Next run', status.nextRunTime ? format(status.nextRunTime) : 'None')}${row('Last run', status.lastRunTime ? format(status.lastRunTime) : 'Never')}${status.lastRunTime && result ? row('Result', result) : ''}</dl>`;
}

const powerCheck = (s, name, label, disabled) => `<label class="folder-choice"><input type="checkbox" name="${name}" ${s[name] ? 'checked' : ''} ${disabled}>${label}</label>`;

export function schedulePreferencesMarkup(status, { saving = false, error = '', backupRunning = false } = {}, escape = value => value) {
  const ready = Boolean(status?.installed && status.settings);
  const s = { ...defaultSchedule(), ...status?.settings };
  const disabled = !ready || saving || backupRunning ? 'disabled' : '';
  return `<form id="schedule-preferences-form" class="schedule-preferences" aria-labelledby="schedule-preferences-title">
    <header><h3 id="schedule-preferences-title">Scheduled backups</h3></header>
    ${ready ? '' : '<p class="muted">Save a schedule in Scheduler first.</p>'}
    <fieldset class="schedule-preferences-checks"><legend>Power &amp; connection</legend>
      ${powerCheck(s, 'startWhenAvailable', 'Run a missed backup when available', disabled)}${powerCheck(s, 'networkRequired', 'Require a network connection', disabled)}
      ${powerCheck(s, 'wakeComputer', 'Wake the computer to run', disabled)}${powerCheck(s, 'allowOnBattery', 'Allow starting on battery power', disabled)}
      ${powerCheck(s, 'stopOnBattery', 'Stop if the computer switches to battery', disabled)}
    </fieldset>
    <fieldset class="schedule-preferences-numbers"><legend>Run limits &amp; recovery</legend>
      <div><label for="schedule-duration">Maximum run time (hours)</label><input id="schedule-duration" name="maxRunHours" type="number" min="1" max="168" value="${s.maxRunHours}" required ${disabled}></div>
      <div><label for="schedule-restarts">Restart attempts</label><input id="schedule-restarts" name="restartCount" type="number" min="0" max="10" value="${s.restartCount}" required ${disabled}></div>
      <div><label for="schedule-restart-delay">Restart interval (minutes)</label><input id="schedule-restart-delay" name="restartMinutes" type="number" min="1" max="1440" value="${s.restartMinutes}" required ${disabled}></div>
    </fieldset>
    ${error ? `<p class="preferences-error" role="alert">${escape(error)}</p>` : ''}
    <button type="submit" class="primary" ${disabled}>${saving ? 'Saving…' : 'Save scheduled backup settings'}</button>
  </form>`;
}

export function updateClock(now = new Date()) {
  const text = document.querySelector('#scheduler-clock');
  if (!text || document.hidden || !document.querySelector('#scheduler-panel')) return;
  text.textContent = clockFormatter.format(now);
  document.querySelector('#scheduler-zone').textContent = clockFormatter.resolvedOptions().timeZone;
  for (const [id, angle] of [['hour', now.getHours() * 30 + now.getMinutes() / 2], ['minute', now.getMinutes() * 6], ['second', now.getSeconds() * 6]]) document.querySelector(`#clock-${id}`).setAttribute('transform', `rotate(${angle} 50 50)`);
  const calendar = document.querySelector('.schedule-calendar');
  const today = localDate(now);
  if (calendar && calendar.dataset.today !== today) {
    calendar.dataset.today = today;
    calendar.querySelectorAll('[data-date]').forEach(button => button.classList.toggle('today', button.dataset.date === today));
  }
}
