// 从 assets/icon.svg 生成各平台图标，产物落在 build/ 供 electron-builder 使用
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import png2icons from 'png2icons';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(resolve(root, 'assets/icon.svg'));
const png = await sharp(svg).resize(1024, 1024).png().toBuffer();

await mkdir(resolve(root, 'build'), { recursive: true });
await writeFile(resolve(root, 'build/icon_512.png'), await sharp(png).resize(512, 512).png().toBuffer());

const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, false);
const icns = png2icons.createICNS(png, png2icons.BICUBIC, 0);
if (!ico || !icns) throw new Error('图标转换失败');

await writeFile(resolve(root, 'build/icon.ico'), ico);
await writeFile(resolve(root, 'build/icon.icns'), icns);
console.log('图标已生成：build/icon.ico, build/icon.icns, build/icon_512.png');
