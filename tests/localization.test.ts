import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function leaves(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === 'object' ? Object.entries(leaves(item as Record<string, unknown>, name)) : [[name, String(item)]];
  }));
}
const folder = path.resolve('src/i18n/locales');
const load = (file: string) => leaves(JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8')));
const base = load('en.json');
describe('complete locale contracts', () => {
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith('.json'))) {
    it(`${file} has complete keys, text and interpolation tokens`, () => {
      const target = load(file);
      expect(Object.keys(target).sort()).toEqual(Object.keys(base).sort());
      for (const [key, text] of Object.entries(target)) {
        expect(text.trim(), key).not.toBe('');
        expect(text.match(/\{\{[^{}]+\}\}/g)?.sort() || [], key).toEqual(base[key].match(/\{\{[^{}]+\}\}/g)?.sort() || []);
        expect(text, key).not.toMatch(/987650\d+|�|&quot;/);
      }
    });
  }
});
