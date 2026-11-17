import { loadingIndicator } from './loading.js';

export function emailDocument(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  content.querySelectorAll('script, iframe, frame, frameset, object, embed, form, input, button, textarea, select, meta, link, base, svg, math, video, audio, source').forEach(element => element.remove());
  content.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['href', 'srcset', 'action', 'formaction', 'target', 'background', 'srcdoc', 'xlink:href'].includes(name)) element.removeAttribute(attribute.name);
    }
    if (element.hasAttribute('src') && !(element.tagName === 'IMG' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(element.getAttribute('src')))) element.removeAttribute('src');
  });
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.6 'Segoe UI',sans-serif;margin:20px;color:#202630;background:white;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${template.innerHTML}</body></html>`;
}

export function readingPane(state, escape, date) {
  if (state.unavailable) return `<section class="reading-pane" aria-label="Email preview"><header class="reading-header"><h2>${escape(state.message.subject || 'No subject')}</h2><p>${escape(state.message.sender || 'Unknown sender')}</p></header><div class="server-mail-notice"><h3>Not backed up</h3><p>${state.onServer ? 'This message is on the server. Back it up to read the full message and download it here.' : 'The local backup is missing or damaged. Check the mailbox and back up this folder again.'}</p><button data-action="selection">Choose backup options</button></div></section>`;
  if (!state.file) return '<section class="reading-pane reading-empty" aria-label="Email preview"><h2>Select an email to read</h2><p>Choose a message from the list above.</p></section>';
  if (state.loading) return `<section class="reading-pane" aria-label="Email preview" aria-busy="true"><p class="empty-pane">${loadingIndicator('Opening email...')}</p></section>`;
  if (state.error) return `<section class="reading-pane" aria-label="Email preview"><p class="empty-pane" role="alert">${escape(state.error)} <button data-action="retry-message">Retry</button></p></section>`;
  const mail = state.message;
  return `<section class="reading-pane" aria-label="Email preview"><header class="reading-header"><h2>${escape(mail.subject)}</h2><dl><div><dt>From</dt><dd>${escape(mail.from)}</dd></div>${mail.to ? `<div><dt>To</dt><dd>${escape(mail.to)}</dd></div>` : ''}${mail.cc ? `<div><dt>Cc</dt><dd>${escape(mail.cc)}</dd></div>` : ''}<div><dt>Date</dt><dd>${date(mail.date)}</dd></div></dl>${mail.attachments?.length ? `<p class="reading-attachments">Attachments: ${mail.attachments.map(item => escape(item.name)).join(', ')}</p>` : ''}</header>${mail.html ? `<iframe class="email-body" title="Email content" sandbox="" referrerpolicy="no-referrer" srcdoc="${escape(emailDocument(mail.html))}"></iframe>` : `<pre class="email-text">${escape(mail.text || 'This email has no message body.')}</pre>`}</section>`;
}
