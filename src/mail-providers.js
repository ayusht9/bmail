export function outlookAddressHost(host) {
  return /^(outlook|hotmail|live|msn)\.(com|in|co\.uk)$/i.test(host?.trim() || '');
}

export function outlookHost(host) {
  return ['outlook.office365.com', 'imap-mail.outlook.com'].includes(host?.trim().toLowerCase()) || outlookAddressHost(host);
}

export function providerForHost(host) {
  const normalized = host?.trim().toLowerCase();
  return outlookHost(host) ? 'outlook' : normalized === 'imap.gmail.com' ? 'google' : normalized === 'imappro.zoho.in' ? 'zoho' : normalized === 'imap.mail.me.com' ? 'icloud' : 'other';
}
