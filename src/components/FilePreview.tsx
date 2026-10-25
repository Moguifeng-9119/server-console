import { useMemo, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useTranslation } from 'react-i18next';

// CSV 解析：支持引号转义；最多返回 maxRows 行，超出置 truncated
export function parseCsv(text: string, maxRows = 100): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false, truncated = false;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    if (rows.length >= maxRows) truncated = true;
  };
  for (let i = 0; i < text.length && !truncated; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else field += c;
  }
  if (!truncated && (field !== '' || row.length)) endRow();
  return { rows, truncated };
}

// 远程图片预览：base64 data URL，支持 适应窗口 / 原始大小 切换
export function ImagePreview({ name, url, truncated, onClose }: { name: string; url: string; truncated: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [fit, setFit] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref, onClose);
  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('filePreview.imageTitle')} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(1100px, 92vw)' }} ref={ref}>
        <h3>{name}</h3>
        {truncated && <p className="note">{t('filePreview.imageTruncated')}</p>}
        <div style={{ overflow: 'auto', maxHeight: '70vh', textAlign: 'center' }}>
          <img src={url} alt={name} style={fit ? { maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' } : { maxWidth: 'none' }} />
        </div>
        <div className="foot">
          <button className="btn" onClick={() => setFit((v) => !v)}>{fit ? t('filePreview.original') : t('filePreview.fit')}</button>
          <button className="btn primary" onClick={onClose}>{t('textViewer.close')}</button>
        </div>
      </div>
    </div>
  );
}

// 远程 CSV 预览：客户端解析渲染前 100 行
export function CsvPreview({ name, text, truncated, onClose }: { name: string; text: string; truncated: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref, onClose);
  const { rows, truncated: cutOff } = useMemo(() => parseCsv(text), [text]);
  const header = rows[0] || [];
  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('filePreview.csvTitle')} onClick={(e) => e.stopPropagation()} style={{ width: 'min(1100px, 92vw)' }} ref={ref}>
        <h3>{name}</h3>
        {(truncated || cutOff) && <p className="note">{t('filePreview.rowsLimited', { n: rows.length - 1 })}</p>}
        <div className="workcenter-table" style={{ maxHeight: '65vh', overflow: 'auto' }}>
          <table>
            <thead><tr>{header.map((cell, i) => <th key={i}>{cell}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((row, r) => <tr key={r}>{header.map((_, c) => <td key={c}>{row[c] ?? ''}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="foot">
          <button className="btn primary" onClick={onClose}>{t('textViewer.close')}</button>
        </div>
      </div>
    </div>
  );
}
