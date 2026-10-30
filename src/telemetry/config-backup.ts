// Only presentation preferences belong in a configuration backup. Session output,
// commands, authentication and arbitrary storage keys are deliberately excluded.
const preferenceValidators: Record<string, (value: string) => boolean> = {
  'sc.theme.user': (v) => ['light', 'dark', 'system'].includes(v),
  'sc.density.user': (v) => ['compact', 'comfy', 'default'].includes(v),
  'sc.lang': (v) => ['en', 'zh-CN', 'zh-TW', 'de', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru'].includes(v),
  'sc.refreshMs': (v) => ['200', '500', '1000', '2000', '5000', '10000'].includes(v),
};
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function validatePresentationBackup(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid presentation preferences');
  const entries = Object.entries(value);
  if (entries.length > 2000) throw new Error('Too many presentation preferences');
  const result: Record<string, string> = {};
  for (const [key, text] of entries) {
    if (typeof text !== 'string' || text.length > 32768) throw new Error('Invalid presentation preference');
    const validator = Object.prototype.hasOwnProperty.call(preferenceValidators, key) ? preferenceValidators[key] : undefined;
    if (validator) { if (!validator(text)) throw new Error('Invalid preference: ' + key); result[key] = text; continue; }
    if (/^sc\.term\.layout\.[\w-]{1,120}$/.test(key)) {
      if (!['single', 'columns', 'rows'].includes(text)) throw new Error('Invalid terminal layout');
    } else if (/^sc\.term\.names\.[\w-]{1,120}$/.test(key)) {
      const names: unknown = JSON.parse(text);
      if (!names || typeof names !== 'object' || Array.isArray(names) || Object.entries(names).length > 100 || Object.entries(names).some(([id, name]) => !/^[\w-]{1,120}$/.test(id) || typeof name !== 'string' || name.length > 80)) throw new Error('Invalid terminal names');
    } else throw new Error('Unsupported presentation preference: ' + key);
    result[key] = text;
  }
  return result;
}

export function exportPresentationBackup(storage: StorageAccess): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (Object.prototype.hasOwnProperty.call(preferenceValidators, key) || /^sc\.term\.(layout|names)\.[\w-]{1,120}$/.test(key))) {
      const value = storage.getItem(key); if (value !== null) values[key] = value;
    }
  }
  return validatePresentationBackup(values);
}

export function importPresentationBackup(storage: StorageAccess, value: unknown): () => void {
  const values = validatePresentationBackup(value);
  const previous = Object.keys(values).map((key) => [key, storage.getItem(key)] as const);
  const rollback = () => {
    for (const [key, text] of previous) { if (text === null) storage.removeItem(key); else storage.setItem(key, text); }
  };
  try { for (const [key, text] of Object.entries(values)) storage.setItem(key, text); }
  catch (error) { rollback(); throw error; }
  return rollback;
}

export type ImportReceipt = { operationId: string; status: string };
export function stagePresentationImport(storage: StorageAccess, operationId: string, value: unknown): void {
  if (!/^[\w-]{1,100}$/.test(operationId)) throw new Error('Invalid import operation ID');
  storage.setItem('sc.pendingImport.' + operationId, JSON.stringify(validatePresentationBackup(value)));
}
export function settlePresentationImport(storage: StorageAccess, receipt: ImportReceipt): boolean {
  if (!/^[\w-]{1,100}$/.test(receipt.operationId)) return false;
  const key = 'sc.pendingImport.' + receipt.operationId, raw = storage.getItem(key);
  if (raw === null || !['committed', 'failed'].includes(receipt.status)) return false;
  if (receipt.status === 'committed') importPresentationBackup(storage, JSON.parse(raw));
  storage.removeItem(key);
  return receipt.status === 'committed';
}
