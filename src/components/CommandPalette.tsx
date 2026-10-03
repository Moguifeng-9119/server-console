import { useEffect, useMemo, useRef, useState } from 'react';
import type { Server } from '../types';

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
  servers,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  servers: Server[];
  actions: PaletteAction[];
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const fromServers = servers.map((s) => ({
      id: 'srv:' + s.id,
      label: '连接 ' + s.name,
      hint: s.host,
      run: () => actions.find((a) => a.id === 'open-server:' + s.id)?.run(),
    }));
    const all = [...fromServers, ...actions];
    if (!query) return all;
    return all.filter((x) => (x.label + ' ' + (x.hint || '')).toLowerCase().includes(query));
  }, [q, servers, actions]);

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
      <div className="dialog" style={{ width: 480, padding: 0 }} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="mini mono"
          style={{ width: '100%', border: 0, borderBottom: '1px solid var(--border)', borderRadius: 0, padding: 12, fontSize: 13 }}
          placeholder="输入服务器名或动作…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); commit(sel); }
            else if (e.key === 'Escape') onClose();
          }}
        />
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          {items.length === 0 && <div className="empty">无匹配项</div>}
          {items.map((it, i) => (
            <div
              key={it.id}
              className={`pal-item ${i === sel ? 'on' : ''}`}
              onClick={() => commit(i)}
              onMouseEnter={() => setSel(i)}
            >
              <span>{it.label}</span>
              {it.hint && <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>{it.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
