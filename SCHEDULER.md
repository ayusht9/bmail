# Scheduling, backup preferences and history

Open **Scheduler** in the account sidebar. The live clock uses the computer's
local time zone; it does not make server or desktop API calls. Select a start
date on the calendar or use the date/time inputs. Arrow keys move calendar focus,
Home/End move within a week, and Enter selects the focused date.

## Recurrences

- One time: a future date and time.
- Daily: every 1–365 days, anchored on the start date.
- Weekly: selected weekdays, every 1–52 weeks.
- Monthly: day 1–31 or the last day. Days 29–31 skip shorter months.
- Every few hours: every 1–24 hours from the start time.

An optional end date is inclusive. The calendar dots and upcoming list preview
the form settings. Windows' reported **Next run** is authoritative, especially
around daylight-saving changes, missed runs and execution conditions. Refresh
status reads Windows without discarding draft edits. Save installs/replaces only
the active account's task. Uncheck Enable and save to pause; Remove unregisters
the task while retaining paused preferences and all backup files.

Tasks use Windows Task Scheduler and run while the current user is signed in,
even when Bmail is closed. No administrator elevation or stored Windows password
is used. Network availability, starting on battery, stopping on battery, waking
the computer and running a missed backup are configurable. Hardware, Windows
power policy and Do not disturb settings can prevent waking or alerts. A network
condition means any network connection, not guaranteed access to the mail server.
The engine's connection timeouts and retries handle connection failures.

Maximum run duration is 1–168 hours. Optional task restarts retry an entire failed
task, separately from the engine's transient-connection retry attempts. Restart
settings apply to any task failure, including authentication errors. By default
task restarts are off. Overlapping task instances are ignored and the engine's
account lock protects against overlapping manual/scheduled backups.

Preferences live in each account's `backup-schedule.json`, with a timestamped
Windows status snapshot in `backup-schedule-status.json`. Schedule updates use an
exclusive account-local lock. The generated launcher restores the account data
path. Saving a replacement retires only that user's exact legacy task names.
Changing machines or moving the app's engine requires saving the schedule again.

## Standard and advanced backup preferences

Open Backup selection. Presets select the full mailbox, a rolling 30-day window,
or custom folders. Save applies the same preferences to manual and scheduled runs.
Advanced controls support exact folder exclusions, rolling received-date windows,
unread/starred filters, sender/subject matching, minimum KB / maximum MB sizes,
newest/oldest server UID order, message limits, connection attempts, increasing
retry delays, connection/socket timeouts, final archive verification, and an
optional full-mailbox coverage refresh after success.

Fixed and rolling date windows cannot be combined. All message filters are sent
as read-only IMAP searches. New downloads are always verified before committing.
Disabling final archive verification skips rechecking retained files outside the
selection; disabling coverage refresh leaves its previous confirmation timestamp.
The full-mailbox check still checks every accessible folder independently of the
selection. Backup options never delete local copies or server messages.

## Notifications and history

Under Advanced backup options, enable alerts for completion, failure, or
stop/cancel separately. Send test notification checks desktop alert delivery.
Alerts use Windows' notification area and may be suppressed by system settings.
They also work for scheduled runs while Bmail is closed. Notification failure
does not change a backup result. Notifications contain the account and saved
count, never message contents or credentials. The notification helper stays alive
briefly to display its alert, so finalization may take several extra seconds.

Backup history in the sidebar shows up to 500 recorded runs per account, stored
atomically as `history.json` in that account's backup directory. It records
downloads, transfer/storage amounts, duration, outcome, selection summary and
sanitized errors. Retries update the same run ID instead of creating duplicate
entries. A failed attempt can appear until the retry updates its result. Existing
last-run metadata is shown as a fallback for accounts without recorded history.
Interrupted or forcibly terminated processes may not have a finalized history
entry; the progress panel reports that interruption separately. Unreadable history
is kept rather than overwritten, and its error is shown without failing a backup.

Development checks use mocked task registration and Windows' native XML parser;
they do not install a real account schedule or send unsolicited test alerts.
