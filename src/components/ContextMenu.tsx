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

  useEffect(() => {
    // 只在“菜单之外”按下鼠标时关闭；右键换行会先触发 mousedown 关旧菜单，
    // 随后目标元素自己的 onContextMenu 再打开新菜单，不会被同一次事件误关。
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const close = () => onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  // 避免超出视口
  const left = Math.max(4, Math.min(x, window.innerWidth - 230));
  const top = Math.max(4, Math.min(y, window.innerHeight - 220));

  return (
    <div ref={ref} className="ctx-menu" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
