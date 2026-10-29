// 一次性脚本：为 v0.16.0 文件预览补充 filePreview.* 键到全部 10 个语言文件
const fs = require('node:fs');
const path = require('node:path');
const folder = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const _keys = ['imageTitle', 'fit', 'original', 'csvTitle', 'rowsLimited', 'imageTruncated'];
const translations = {
  en: { imageTitle: 'Image preview', fit: 'Fit window', original: 'Original size', csvTitle: 'CSV preview', rowsLimited: 'Showing the first {{n}} rows only', imageTruncated: 'Only the first 2 MB were loaded.' },
  'zh-CN': { imageTitle: '图片预览', fit: '适应窗口', original: '原始大小', csvTitle: 'CSV 预览', rowsLimited: '仅显示前 {{n}} 行', imageTruncated: '仅加载了前 2 MB。' },
  'zh-TW': { imageTitle: '圖片預覽', fit: '適應視窗', original: '原始大小', csvTitle: 'CSV 預覽', rowsLimited: '僅顯示前 {{n}} 列', imageTruncated: '僅載入了前 2 MB。' },
  ja: { imageTitle: '画像プレビュー', fit: 'ウィンドウに合わせる', original: '元のサイズ', csvTitle: 'CSV プレビュー', rowsLimited: '先頭 {{n}} 行のみ表示しています', imageTruncated: '最初の 2 MB のみ読み込みました。' },
  ko: { imageTitle: '이미지 미리보기', fit: '창에 맞추기', original: '원래 크기', csvTitle: 'CSV 미리보기', rowsLimited: '처음 {{n}}행만 표시합니다', imageTruncated: '처음 2 MB만 불러왔습니다.' },
  es: { imageTitle: 'Vista previa de imagen', fit: 'Ajustar a la ventana', original: 'Tamaño original', csvTitle: 'Vista previa de CSV', rowsLimited: 'Mostrando solo las primeras {{n}} filas', imageTruncated: 'Solo se cargaron los primeros 2 MB.' },
  fr: { imageTitle: 'Aperçu de l’image', fit: 'Ajuster à la fenêtre', original: 'Taille d’origine', csvTitle: 'Aperçu CSV', rowsLimited: 'Seules les {{n}} premières lignes sont affichées', imageTruncated: 'Seuls les 2 premiers Mo ont été chargés.' },
  de: { imageTitle: 'Bildvorschau', fit: 'An Fenster anpassen', original: 'Originalgröße', csvTitle: 'CSV-Vorschau', rowsLimited: 'Nur die ersten {{n}} Zeilen werden angezeigt', imageTruncated: 'Nur die ersten 2 MB wurden geladen.' },
  ru: { imageTitle: 'Предпросмотр изображения', fit: 'Вписать в окно', original: 'Исходный размер', csvTitle: 'Предпросмотр CSV', rowsLimited: 'Показаны только первые {{n}} строк', imageTruncated: 'Загружены только первые 2 МБ.' },
  'pt-BR': { imageTitle: 'Pré-visualização de imagem', fit: 'Ajustar à janela', original: 'Tamanho original', csvTitle: 'Pré-visualização de CSV', rowsLimited: 'Mostrando apenas as primeiras {{n}} linhas', imageTruncated: 'Apenas os primeiros 2 MB foram carregados.' },
};

for (const [locale, dict] of Object.entries(translations)) {
  const file = path.join(folder, locale + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.filePreview = dict;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(locale, 'updated');
}
