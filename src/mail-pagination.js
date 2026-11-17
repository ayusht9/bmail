export function mailPagination(state) {
  const { total = 0, page = 1, pageSize = 50, pages = 1, loading = false } = state;
  const button = (label, text, destination, disabled) => `<button type="button" data-action="mail-page" data-page="${destination}" aria-label="${label}" title="${label}" ${disabled || loading ? 'disabled' : ''}>${text}</button>`;
  return `<nav class="mail-pagination" aria-label="Mail pagination">
    <div class="mail-page-size-control"><label for="mail-page-size">Per page</label><select id="mail-page-size" ${loading ? 'disabled' : ''}>${[25, 50, 100].map(size => `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></div>
    <span class="mail-page-summary" role="status" aria-live="polite" aria-atomic="true">${total ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total} messages` : '0 messages'}</span>
    <span class="mail-page-position">Page ${page} of ${pages}</span>
    <div class="mail-page-buttons">
      ${button('First page', '&#171;', 1, page <= 1)}
      ${button('Previous page', '&#8249;', page - 1, page <= 1)}
      ${button('Next page', '&#8250;', page + 1, page >= pages)}
      ${button('Last page', '&#187;', pages, page >= pages)}
    </div>
  </nav>`;
}
