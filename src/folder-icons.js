const aliases = {
  inbox: ['inbox'],
  sent: ['sent', 'sent mail', 'sentmail', 'sent items', 'sent messages'],
  drafts: ['draft', 'drafts'],
  trash: ['trash', 'bin', 'deleted', 'deleted items', 'deleted messages'],
  spam: ['spam', 'junk', 'junk mail', 'junk email', 'bulk mail'],
  archive: ['archive', 'archives', 'all mail', 'allmail'],
  starred: ['starred', 'favorites', 'favourites'],
  important: ['important', 'flagged'],
  outbox: ['outbox'],
  templates: ['templates'],
};

export function folderKind(name) {
  const leaf = String(name).normalize('NFKC').split(/[\\/.]/).at(-1).toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return Object.keys(aliases).find(kind => aliases[kind].includes(leaf)) || 'folder';
}

const paths = {
  inbox: '<path d="m3 4-2 8v5h18v-5l-2-8ZM1 12h5l2 3h4l2-3h5"/>',
  sent: '<path d="m2 3 16 7-16 7 3-7Zm3 7h13"/>',
  drafts: '<path d="m12 3 5 5M4 13l-1 5 5-1L18 7l-4-4Z"/>',
  trash: '<path d="M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7m4-7v7"/>',
  spam: '<path d="m10 2 7 3v5c0 4-3 6-7 8-4-2-7-4-7-8V5ZM10 6v5m0 3v1"/>',
  archive: '<path d="M2 3h16v4H2ZM4 7v11h12V7M7 10h6"/>',
  starred: '<path d="m10 2 2.5 5 5.5.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9L7.5 7Z"/>',
  important: '<path d="M4 18V3h12l-3 4 3 4H4"/>',
  outbox: '<path d="M2 12v6h16v-6M10 14V2m-4 4 4-4 4 4"/>',
  templates: '<path d="M4 2h8l4 4v12H4ZM12 2v5h4M7 10h6m-6 4h6"/>',
  folder: '<path d="M2 5h6l2 2h8v9H2z"/>',
};

export function folderIcon(name) {
  const kind = folderKind(name);
  return `<svg aria-hidden="true" viewBox="0 0 20 20" data-folder-icon="${kind}">${paths[kind]}</svg>`;
}
