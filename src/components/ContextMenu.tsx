import { useEffect, useRef } from 'react';

export function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const node = ref.current;
    const closeMenu = () => closeRef.current();
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    // 只在“菜单之外”按下鼠标时关闭；右键换行会先触发 mousedown 关旧菜单，
    // 随后目标元素自己的 onContextMenu 再打开新菜单，不会被同一次事件误关。
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    const close = () => closeMenu();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', esc);
      if (previous?.isConnected && (node?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
    };
  }, []);

  // 避免超出视口
  const left = Math.max(4, Math.min(x, window.innerWidth - 230));
  const top = Math.max(4, Math.min(y, window.innerHeight - 220));

  return (
    <div ref={ref} className="ctx-menu" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
