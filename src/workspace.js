export const workspaceTabs = [
  ['mailbox', 'Mailbox'], ['overview', 'Overview'], ['options', 'Backup options'],
  ['scheduler', 'Scheduler'], ['history', 'History'], ['activity', 'Activity'], ['preferences', 'Preferences'],
];

export function workspaceTabStrip(active, busy) {
  return `<div class="workspace-tabs" role="tablist" aria-label="Workspace">${workspaceTabs.map(([id, label]) =>
    `<button type="button" role="tab" id="tab-${id}" data-action="select-tab" data-tab="${id}" aria-selected="${id === active}" aria-controls="view-${id}" tabindex="${id === active ? 0 : -1}" ${busy ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
}
