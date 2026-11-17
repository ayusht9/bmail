const HISTORY_LIMIT = 100;

// Owns workspace history only; callers handle rendering, drafts, and busy state.
export function createNavigation(initial) {
  let entries = [{ ...initial }];
  let index = 0;

  function canMove(direction) {
    const next = index + direction;
    return next >= 0 && next < entries.length;
  }

  return {
    canMove,

    remember(tab, folder, filter) {
      const current = entries[index];
      current.filter = filter;
      if (current.tab === tab && current.folder === folder) return;

      // A new destination replaces the forward history after going back.
      entries = entries.slice(0, index + 1);
      entries.push({ tab, folder, filter });
      if (entries.length > HISTORY_LIMIT) entries.shift();
      index = entries.length - 1;
    },

    move(direction, filter) {
      if (!canMove(direction)) return null;
      entries[index].filter = filter;
      index += direction;
      return { ...entries[index] };
    },

    reset(destination) {
      entries = [{ ...destination }];
      index = 0;
    },
  };
}
