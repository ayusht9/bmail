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

export function scheduleFromForm(form) {
  const values = new FormData(form);
  const value = name => form.elements.namedItem(name)?.value;
  const frequency = value('frequency');
  const weekdays = [...form.querySelectorAll('[name="weekdays"]:checked')].map(input => Number(input.value));
  return { enabled: values.has('enabled'), frequency, startDate: value('startDate'), time: value('time'),
    weekdays: frequency === 'weekly' ? weekdays : weekdays.length ? weekdays : [1], monthDay: frequency === 'monthly' ? value('monthDay') : '1',
    every: ['daily','weekly'].includes(frequency) ? Number(value('every')) : 1, intervalHours: frequency === 'interval' ? Number(value('intervalHours')) : 6,
    endDate: value('endDate') || null, startWhenAvailable: values.has('startWhenAvailable'), networkRequired: values.has('networkRequired'),
    wakeComputer: values.has('wakeComputer'), allowOnBattery: values.has('allowOnBattery'), stopOnBattery: values.has('stopOnBattery'),
    maxRunHours: Number(value('maxRunHours')), restartCount: Number(value('restartCount')), restartMinutes: Number(value('restartMinutes')),
    allFolders: form.elements.scheduleAllFolders.checked,
    folders: [...form.querySelectorAll('[name="scheduledFolders"]:checked')].map(input => input.value) };
}

export function scheduleFolderChoices(dashboard, selected, disabled, escape) {
  const names = [...new Set([...(dashboard.mailboxes?.folders || []), ...(dashboard.localStats?.folders || []).map(folder => folder.name),
    ...(dashboard.mailboxStatus?.folders || []).map(folder => folder.name), ...selected])].sort();
  return `<fieldset id="schedule-folder-choices" ${disabled ? 'disabled' : ''}><legend>Scheduled folders</legend>${names.length ? names.map(name => `<label class="folder-choice"><input type="checkbox" name="scheduledFolders" value="${escape(name)}" ${selected.includes(name) ? 'checked' : ''}><span>${escape(name)}</span></label>`).join('') : '<p class="muted">Load mailbox folders to choose a custom selection.</p>'}</fieldset>`;
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
    return `<td><button type="button" data-action="schedule-day" data-date="${iso}" tabindex="${iso === tabStop ? 0 : -1}" aria-label="${escape(new Intl.DateTimeFormat('en-IN', { dateStyle: 'full' }).format(date))}" aria-pressed="${iso === schedule.startDate}" class="${date.getMonth() !== month.getMonth() ? 'outside ' : ''}${iso === today ? 'today ' : ''}${dots.has(iso) ? 'scheduled ' : ''}${iso === schedule.startDate ? 'chosen' : ''}">${date.getDate()}</button></td>`;
  });
  return `<div class="calendar-heading"><button type="button" data-action="schedule-prev" aria-label="Previous month">‹</button><strong>${escape(new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(first))}</strong><button type="button" data-action="schedule-next" aria-label="Next month">›</button></div>
    <table class="schedule-calendar" role="grid" aria-label="Schedule calendar"><thead><tr>${weekdayNames.map(day => `<th scope="col" abbr="${day}">${day.slice(0, 2)}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: 6 }, (_, row) => `<tr>${cells.slice(row * 7, row * 7 + 7).join('')}</tr>`).join('')}</tbody></table><p class="calendar-legend">Blue dots: planned run dates. Select a date to change the start.</p>`;
}

export function schedulerView(dashboard, escape, draft = null) {
  const s = { ...defaultSchedule(), ...dashboard.schedule?.settings, ...draft };
  const checkbox = (name, label) => `<label class="folder-choice"><input type="checkbox" name="${name}" ${s[name] ? 'checked' : ''}>${label}</label>`;
  return `<section id="scheduler-panel" class="scheduler-page" aria-labelledby="scheduler-title"><form id="scheduler-form"><h2 id="scheduler-title">Backup scheduler</h2><p>Schedule for ${escape(dashboard.user)}. Times use this computer's local time zone.</p>
    <div class="scheduler-layout"><aside class="scheduler-calendar-pane"><div class="scheduler-clock"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45"/>${Array.from({ length: 12 }, (_, hour) => `<line x1="50" y1="8" x2="50" y2="13" transform="rotate(${hour * 30} 50 50)"/>`).join('')}<line id="clock-hour" x1="50" y1="50" x2="50" y2="26"/><line id="clock-minute" x1="50" y1="50" x2="50" y2="16"/><line id="clock-second" x1="50" y1="54" x2="50" y2="12"/><circle cx="50" cy="50" r="2"/></svg><time id="scheduler-clock" aria-label="Current local time"></time><small id="scheduler-zone"></small></div><div id="schedule-calendar"></div><div id="schedule-upcoming"></div></aside>
    <section class="scheduler-fields" aria-label="Schedule settings">${checkbox('enabled', 'Enable scheduled backups')}
      <label for="schedule-frequency">Repeat</label><select id="schedule-frequency" name="frequency">${[['once','One time'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['interval','Every few hours']].map(([value,label]) => `<option value="${value}" ${s.frequency === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <div class="date-fields"><div><label for="schedule-date">Start date</label><input id="schedule-date" name="startDate" type="date" value="${escape(s.startDate)}" required></div><div><label for="schedule-time">Start time</label><input id="schedule-time" name="time" type="time" value="${escape(s.time)}" required></div></div>
      <div data-recurrence="daily weekly"><label for="schedule-every">Repeat every (days / weeks)</label><input id="schedule-every" name="every" type="number" min="1" max="365" value="${s.every}" required></div>
      <fieldset data-recurrence="weekly" class="schedule-weekdays"><legend>Days of week</legend>${weekdayNames.map((day,index) => `<label><input type="checkbox" name="weekdays" value="${index}" ${s.weekdays.includes(index) ? 'checked' : ''}>${day.slice(0, 3)}</label>`).join('')}</fieldset>
      <div data-recurrence="monthly"><label for="schedule-month-day">Day of month</label><select id="schedule-month-day" name="monthDay">${[...Array.from({ length: 31 }, (_, index) => String(index + 1)), 'last'].map(day => `<option value="${day}" ${s.monthDay === day ? 'selected' : ''}>${day === 'last' ? 'Last day' : day}</option>`).join('')}</select><p class="muted">Dates 29–31 skip months without that date. Use Last day to run every month.</p></div>
      <div data-recurrence="interval"><label for="schedule-hours">Interval (hours)</label><input id="schedule-hours" name="intervalHours" type="number" min="1" max="24" value="${s.intervalHours}" required></div>
      <label for="schedule-end">End date (optional)</label><input id="schedule-end" name="endDate" type="date" value="${escape(s.endDate || '')}">
      <section class="scheduled-folder-selection"><h3>Folders for scheduled backups</h3><label class="folder-choice"><input id="schedule-all-folders" type="checkbox" name="scheduleAllFolders" ${s.allFolders ? 'checked' : ''}>All mailbox folders</label><button type="button" data-action="schedule-load-folders" ${dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>Load / refresh scheduled folders</button><div id="schedule-folder-options">${scheduleFolderChoices(dashboard, s.folders, s.allFolders, escape)}</div><p class="muted">This folder choice is independent of manual backups. Date filters, exclusions and limits follow Backup options.</p></section>
      <details class="scheduler-advanced" ${s._uiAdvancedOpen ? 'open' : ''}><summary>Power, network and recovery</summary>${checkbox('startWhenAvailable','Run a missed backup when available')}${checkbox('networkRequired','Require a network connection')}${checkbox('wakeComputer','Ask Windows to wake the computer')}${checkbox('allowOnBattery','Allow starting on battery power')}${checkbox('stopOnBattery','Stop if the computer switches to battery')}
        <label for="schedule-duration">Maximum run duration (hours)</label><input id="schedule-duration" name="maxRunHours" type="number" min="1" max="168" value="${s.maxRunHours}" required>
        <div class="date-fields"><div><label for="schedule-restarts">Task restart attempts</label><input id="schedule-restarts" name="restartCount" type="number" min="0" max="10" value="${s.restartCount}" required></div><div><label for="schedule-restart-delay">Restart interval (minutes)</label><input id="schedule-restart-delay" name="restartMinutes" type="number" min="1" max="1440" value="${s.restartMinutes}" required></div></div></details>
      <p class="muted">Runs with Bmail closed while you are signed in. Windows power/network policies may delay a run. Overlapping runs are ignored.</p>
      <div id="schedule-status" class="schedule-status"></div><p id="schedule-error" role="alert"></p>
    </section></div><div class="dialog-actions"><button type="button" data-action="schedule-remove" ${dashboard.scheduleInstalled ? '' : 'disabled'}>Remove schedule</button><button type="button" data-action="schedule-read" ${!dashboard.credentialReady ? 'disabled' : ''}>Refresh status</button><button type="submit" class="primary" ${dashboard.backupRunning || !dashboard.credentialReady ? 'disabled' : ''}>Save schedule</button></div></form></section>`;
}

export function updateClock(now = new Date()) {
  const text = document.querySelector('#scheduler-clock');
  if (!text || document.hidden || !document.querySelector('#scheduler-panel')) return;
  text.textContent = new Intl.DateTimeFormat('en-IN', { timeStyle: 'medium' }).format(now);
  document.querySelector('#scheduler-zone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const [id, angle] of [['hour', now.getHours() * 30 + now.getMinutes() / 2], ['minute', now.getMinutes() * 6], ['second', now.getSeconds() * 6]]) document.querySelector(`#clock-${id}`).setAttribute('transform', `rotate(${angle} 50 50)`);
  document.querySelectorAll('.schedule-calendar [data-date]').forEach(button => button.classList.toggle('today', button.dataset.date === localDate(now)));
}
