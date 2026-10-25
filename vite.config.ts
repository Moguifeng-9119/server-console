import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 生产构建注入 CSP（dev 不注入，避免影响 HMR）。
// script-src 的 hash 对应 index.html 里首帧主题初始化内联脚本；
// 构建时从 index.html 实际内容计算，避免脚本改动后 hash 漂移被 CSP 拦截。
// vite 会把 config 打包到 .vite-temp 临时文件执行，import.meta.url 的相对路径不可靠，用 cwd（vite 始终在项目根启动）
const indexHtml = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
// hash 必须与浏览器解析结果一致：HTML 解析会把 CRLF 规范化为 LF，先做同样归一
const themeScript = (indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '').replace(/\r\n/g, '\n');
if (!themeScript.trim()) throw new Error('index.html theme bootstrap script not found for CSP hash');
const THEME_SCRIPT_HASH = 'sha256-' + createHash('sha256').update(themeScript).digest('base64');
const CSP = [
  "default-src 'self'",
  `script-src 'self' '${THEME_SCRIPT_HASH}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
].join('; ');

function injectCsp(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  plugins: [react(), injectCsp()],
  base: './',
  server: { port: 5173 },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
