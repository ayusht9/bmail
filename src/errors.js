export const errorMessages = Object.freeze({
  timeout: 'The mail server took too long to respond. Check your internet connection and mailbox server settings, then try again.',
  connection: 'Could not connect to the mail server. Check your internet connection and try again.',
  server: 'Could not find your mail server. Check the IMAP server address in Account settings, then try again.',
  outlook: 'Outlook requires Microsoft sign-in. Use Account settings to enter your application client ID and sign in again.',
  authentication: 'Could not sign in to your mailbox. Check your sign-in details and IMAP access in Account settings.',
  secure: 'Could not establish a secure connection to the mail server. Check your computer clock and mailbox server settings.',
  busy: 'A mailbox task is still running. Wait for it to finish, or stop the backup, then try again.',
  disk: 'There is not enough disk space. Free up some space and try again. Your saved emails have been kept.',
  permission: 'Bmail could not access a required file or folder. Check its permissions and try again.',
  saved: 'This saved email is unavailable. Check that your backup folder is accessible, then try again.',
  damaged: 'Some saved data could not be read. Your existing files have been kept. Restart Bmail and try again.',
  identity: 'These settings belong to a different mailbox. Add a separate account to keep existing backups safe.',
  schedule: 'Could not update the backup schedule. Check Windows Task Scheduler permissions and try again.',
  export: 'Could not save the email. Check the destination folder and available disk space, then try again.',
  preferences: 'Could not load or save your preferences. Restart Bmail and try again.',
  setup: 'Could not save your mailbox settings. Review the details and try again.',
  runtime: 'A required Bmail component is unavailable. Reinstall Bmail and try again.',
  generic: 'Something went wrong. Please try again. If the problem continues, restart Bmail.',
});

const safeMessages = new Set([...Object.values(errorMessages),
  'Review your schedule settings and try again.', 'Mailbox check failed. See the error above.', 'Action failed. See the error above.',
  'Enter your complete email address.', 'Enter a valid IMAP server hostname.',
  'Enter a TLS port between 1 and 65535.',
  'Gmail requires TLS port 993. Port 25 cannot receive Gmail backups.',
  'Enter your application-specific password. Spaces between Google app-password groups are accepted.',
  'Enter the Microsoft application (client) ID from your app registration.',
  'Choose a recurrence.', 'Choose valid start and end dates.', 'Choose a valid time.',
  'The end date must not be before the start date.', 'Choose valid scheduled folders.',
  'Choose at least one scheduled folder.', 'Choose valid weekdays.', 'Choose at least one weekday.',
  'Choose a day from 1 to 31, or the last day.', 'Choose a future time for a one-time backup.',
  'The schedule end date has already passed.',
]);

function describe(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error.slice(0, 16000);
  if (typeof error === 'object') {
    // Only inspect known diagnostic fields; never stringify arbitrary objects or tokens.
    return ['code', 'name', 'message', 'reason', 'authenticationFailed'].map(key => {
      try { return typeof error[key] === 'string' ? error[key].slice(0, 16000) : error[key] === true ? key : ''; }
      catch { return ''; }
    }).join(' ');
  }
  return '';
}

export function userMessage(error, context = '') {
  if (error instanceof PublicError) return error.message;
  const text = describe(error).trim();
  if (safeMessages.has(text)) return text;
  let originalMessage = '';
  try { if (typeof error?.message === 'string') originalMessage = error.message; } catch {}
  if (safeMessages.has(originalMessage)) return originalMessage;
  if (text.startsWith('Backup failed. ') && safeMessages.has(text.slice(15))) return text;
  if (/NEW_MAIL_CHECK_BUSY|BACKUP_BUSY|already (?:running|active)|mailbox.*busy|finish (?:or stop|the current)|stop or finish|wait for the current/i.test(text)) return errorMessages.busy;
  if (/saved Outlook server|Outlook.*(?:sign.in|app password|client ID)|Microsoft.*(?:sign.in|client.id|app.registration)|OUTLOOK_SIGN_IN_REQUIRED/i.test(text)) return errorMessages.outlook;
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timed?\s*out|timeout/i.test(text)) return errorMessages.timeout;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|INVALID_HOST/i.test(text)) return errorMessages.server;
  if (/authenticationFailed|AUTHENTICATIONFAILED|AUTHENTICATION_FAILED|AUTHFAILED|AUTHENTICATE.*failed|LOGIN failed|authentication (?:rejected|failed|failure)|invalid credentials|invalid.grant|credentials do not match|could not sign in/i.test(text)) return errorMessages.authentication;
  if (/CERT_|certificate|self.signed|TLS handshake|SSL routines/i.test(text)) return errorMessages.secure;
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket.*(?:closed|ended)|connection (?:failed|closed|lost)/i.test(text)) return errorMessages.connection;
  if (/ENOSPC|disk.*full|not enough.*space/i.test(text)) return errorMessages.disk;
  if (/EACCES|EPERM|access.*denied|permission/i.test(text)) return context === 'schedule' ? errorMessages.schedule : errorMessages.permission;
  if (/identity|already belongs to another|different mailbox/i.test(text)) return errorMessages.identity;
  if (/Saved email is unavailable|ENOENT|file.*not.*found|message.*unavailable/i.test(text)) return errorMessages.saved;
  if (/JSON|SyntaxError|corrupt|unreadable|could not be read/i.test(text)) return errorMessages.damaged;
  if (/runtime.*missing|component.*missing|reinstall|Could not start (?:Node|PowerShell)/i.test(text)) return errorMessages.runtime;
  if (context === 'schedule' || /scheduler unavailable/i.test(text)) return errorMessages.schedule;
  if (/^Choose a valid (?:every|intervalHours|maxRunHours|restartCount|restartMinutes|enabled|startWhenAvailable|networkRequired|wakeComputer|allowOnBattery|stopOnBattery|allFolders)\.$/.test(originalMessage || text)) return 'Review your schedule settings and try again.';
  return errorMessages[context] || errorMessages.generic;
}

export class PublicError extends Error {
  constructor(error, context) {
    super(userMessage(error, context));
    this.name = 'PublicError';
    this.code = /NEW_MAIL_CHECK_BUSY|BACKUP_BUSY/.test(describe(error)) ? 'NEW_MAIL_CHECK_BUSY' : 'APP_ERROR';
  }
}

export function createSafeInvoke(nativeInvoke) {
  const contexts = { configure_mailbox: 'setup', begin_outlook_sign_in: 'outlook', get_saved_message: 'saved', export_mail: 'export',
    manage_schedule: 'schedule', get_desktop_preferences: 'preferences', save_desktop_preferences: 'preferences' };
  return async (command, args) => {
    try { return await nativeInvoke(command, args); }
    catch (error) { throw new PublicError(error, contexts[command]); }
  };
}

export function installGlobalErrorHandlers(target, report) {
  let reporting = false;
  const handle = event => {
    event.preventDefault?.();
    if (reporting) return;
    reporting = true;
    try { report(userMessage(event.reason || event.error || event.message)); }
    catch { /* A failure in the fallback must not cause another error loop. */ }
    finally { reporting = false; }
  };
  target.addEventListener('error', handle);
  target.addEventListener('unhandledrejection', handle);
  return () => {
    target.removeEventListener('error', handle);
    target.removeEventListener('unhandledrejection', handle);
  };
}
