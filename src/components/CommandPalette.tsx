import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

// Ctrl+K 命令面板：快速切服务器 / 执行全局动作
export function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, dialogRef, onClose);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const all = actions;
    if (!query) return all;
    return all.filter((x) => (x.label + ' ' + (x.hint || '')).toLowerCase().includes(query));
  }, [q, actions]);

  if (!open) return null;

  const commit = (idx: number) => {
    const it = items[idx];
    if (!it) return;
    it.run();
    onClose();
  };

  return (
    <div
      className="mask"
      style={{ alignItems: 'flex-start', paddingTop: 120 }}
      onClick={onClose}
    >
      <div className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('topbar.search')} tabIndex={-1} style={{ width: 480, padding: 0 }} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="mini mono"
          style={{ width: '100%', border: 0, borderBottom: '1px solid var(--border)', borderRadius: 0, padding: 12, fontSize: 13 }}
          placeholder={t('palette.placeholder')} aria-label={t('palette.placeholder')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.max(0, Math.min(v + 1, items.length - 1))); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); commit(sel); }
            else if (e.key === 'Escape') onClose();
          }}
        />
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          {items.length === 0 && <div className="empty">{t('palette.noMatch')}</div>}
          {items.map((it, i) => (
            <button
              key={it.id}
              className={`pal-item ${i === sel ? 'on' : ''}`}
              onClick={() => commit(i)}
              onMouseEnter={() => setSel(i)}
            >
              <span>{it.label}</span>
              {it.hint && <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>{it.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
