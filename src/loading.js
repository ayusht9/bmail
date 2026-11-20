export function loadingIndicator(label = 'Loading') {
  return `<span class="loading-indicator" role="status"><span class="spinner" aria-hidden="true"></span><span>${label}</span></span>`;
}
