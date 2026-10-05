import { useLayoutEffect, useRef, type RefObject } from 'react';

const stack: HTMLElement[] = [];
let layer = 100;
const focusable = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]';

export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!open || !node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = node.closest<HTMLElement>('.mask,.td-root') || (node.previousElementSibling instanceof HTMLElement && node.previousElementSibling.classList.contains('mask') ? node.previousElementSibling : null);
    const previousLayer = node.style.zIndex;
    const previousOverlayLayer = overlay?.style.zIndex || '';
    layer += 2;
    if (overlay) overlay.style.zIndex = String(layer);
    node.style.zIndex = String(layer + 1);
    stack.push(node);
    const controls = () => [...node.querySelectorAll<HTMLElement>(focusable)].filter((item) => item.getClientRects().length > 0);
    (controls()[0] || node).focus();
    const keydown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== node) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); node.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => {
      if (stack[stack.length - 1] === node && !node.contains(event.target as Node)) (controls()[0] || node).focus();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      stack.splice(stack.indexOf(node), 1);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      node.style.zIndex = previousLayer;
      if (overlay) overlay.style.zIndex = previousOverlayLayer;
      if (previous?.isConnected) previous.focus();
    };
  }, [open, ref]);
}
