// Keep controls connected between pointer-down and click. Replacing a pressed
// button cancels the browser's click, making the first activation disappear.
export function createRenderGuard(target, redraw, schedule = setTimeout, cancel = clearTimeout) {
  const pointers = new Set();
  let pending = false;
  let timer = null;
  let awaitingClick = false;
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  const release = event => {
    if (event.type === 'blur' && event.target !== target) return;
    if (event.type === 'blur') pointers.clear();
    else pointers.delete(event.pointerId);
    awaitingClick = event.type === 'pointerup';
    if (pointers.size) return;
    clear();
    // pointerup's default click must reach its original control first.
    timer = schedule(() => {
      timer = null;
      awaitingClick = false;
      if (!pending || pointers.size) return;
      pending = false;
      redraw();
    }, awaitingClick ? 500 : 0);
  };
  target.addEventListener('pointerdown', event => { pointers.add(event.pointerId); }, true);
  for (const name of ['pointerup', 'pointercancel', 'blur']) target.addEventListener(name, release, true);
  target.addEventListener('click', () => {
    awaitingClick = false;
    clear();
    if (pending && !pointers.size) timer = schedule(() => {
      timer = null;
      if (!pending || pointers.size || awaitingClick) return;
      pending = false;
      redraw();
    }, 0);
  }, true);
  return {
    defer() {
      if (pointers.size || awaitingClick) { pending = true; return true; }
      pending = false;
      clear();
      return false;
    },
  };
}
