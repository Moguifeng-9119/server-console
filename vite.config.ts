import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 生产构建注入 CSP（dev 不注入，避免影响 HMR）。
// script-src 的 hash 对应 index.html 里首帧主题初始化内联脚本；
// 改动该脚本内容后必须重新计算并同步这里的 hash。
const THEME_SCRIPT_HASH = 'sha256-Z2s1eEJ5be5M+7tqXOLt9B32CjoTUAFf6oP638QKwVY=';
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
