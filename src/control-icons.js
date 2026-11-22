const paths = {
  cloud: '<path d="M6 15H5a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 15 6a4.5 4.5 0 0 1 0 9h-1M10 18V9m-3 3 3-3 3 3"/>',
  schedule: '<rect x="3" y="4" width="14" height="14" rx="2"/><path d="M6 2v4m8-4v4M3 8h14m-7 3v3l2 1"/>',
  play: '<path d="m7 4 9 6-9 6Z"/>',
  pause: '<path d="M7 4v12m6-12v12"/>',
  stop: '<rect x="5" y="5" width="10" height="10" rx="1"/>',
  cancel: '<path d="m5 5 10 10M15 5 5 15"/>',
  folder: '<path d="M2 6V4h6l2 2h8v3M2 7h16l-2 10H4Z"/>',
};
export const controlIcon = name => `<svg aria-hidden="true" viewBox="0 0 20 20">${paths[name]}</svg>`;
