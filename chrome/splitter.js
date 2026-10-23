const split = window.magnetSplit;
let dragging = false;

function endDrag() {
  if (!dragging) return;
  dragging = false;
  document.documentElement.classList.remove('is-dragging', 'is-full');
  if (split && split.end) split.end();
}

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !split) return;
  e.preventDefault();
  dragging = true;
  document.documentElement.classList.add('is-dragging', 'is-full');
  try {
    split.start(e.screenX);
    document.body.setPointerCapture(e.pointerId);
  } catch (_) {
    dragging = false;
    document.documentElement.classList.remove('is-dragging', 'is-full');
  }
});

document.addEventListener('pointermove', (e) => {
  if (!dragging || !split) return;
  split.move(e.screenX);
});

document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') endDrag();
});
