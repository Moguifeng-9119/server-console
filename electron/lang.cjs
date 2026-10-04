// 应用界面语言（主进程侧）：设置里切换语言时同步到这里，供主进程发出的系统通知使用
let appLanguage = 'en';

const DICT = {
  en: {
    done: 'Transfer finished: {{name}}',
    fail: 'Transfer failed: {{name}}',
    size: 'Transferred {{size}}',
    doneShort: 'Transfer finished',
    up: 'Upload',
    down: 'Download',
    relay: 'Server relay',
  },
  'zh-CN': {
    done: '传输完成：{{name}}',
    fail: '传输失败：{{name}}',
    size: '已传输 {{size}}',
    doneShort: '传输已完成',
    up: '上传',
    down: '下载',
    relay: '服务器互传',
  },
  'zh-TW': {
    done: '傳輸完成：{{name}}',
    fail: '傳輸失敗：{{name}}',
    size: '已傳輸 {{size}}',
    doneShort: '傳輸已完成',
    up: '上傳',
    down: '下載',
    relay: '伺服器互傳',
  },
  ja: {
    done: '転送完了：{{name}}',
    fail: '転送失敗：{{name}}',
    size: '{{size}} 転送済み',
    doneShort: '転送完了',
    up: 'アップロード',
    down: 'ダウンロード',
    relay: 'サーバー間転送',
  },
  ko: {
    done: '전송 완료: {{name}}',
    fail: '전송 실패: {{name}}',
    size: '{{size}} 전송됨',
    doneShort: '전송 완료',
    up: '업로드',
    down: '다운로드',
    relay: '서버 간 전송',
  },
  es: {
    done: 'Transferencia completada: {{name}}',
    fail: 'Transferencia fallida: {{name}}',
    size: '{{size}} transferidos',
    doneShort: 'Transferencia completada',
    up: 'Subida',
    down: 'Descarga',
    relay: 'Relé entre servidores',
  },
  fr: {
    done: 'Transfert terminé : {{name}}',
    fail: 'Échec du transfert : {{name}}',
    size: '{{size}} transférés',
    doneShort: 'Transfert terminé',
    up: 'Envoi',
    down: 'Réception',
    relay: 'Relais entre serveurs',
  },
  de: {
    done: 'Übertragung abgeschlossen: {{name}}',
    fail: 'Übertragung fehlgeschlagen: {{name}}',
    size: '{{size}} übertragen',
    doneShort: 'Übertragung abgeschlossen',
    up: 'Hochladen',
    down: 'Herunterladen',
    relay: 'Server-Relay',
  },
  ru: {
    done: 'Передача завершена: {{name}}',
    fail: 'Ошибка передачи: {{name}}',
    size: 'Передано {{size}}',
    doneShort: 'Передача завершена',
    up: 'Отправка',
    down: 'Загрузка',
    relay: 'Ретрансляция между серверами',
  },
  'pt-BR': {
    done: 'Transferência concluída: {{name}}',
    fail: 'Falha na transferência: {{name}}',
    size: '{{size}} transferidos',
    doneShort: 'Transferência concluída',
    up: 'Envio',
    down: 'Recepção',
    relay: 'Retransmissão entre servidores',
  },
};

function setLanguage(lang) {
  if (lang && DICT[lang]) appLanguage = lang;
}

// 取词：t('done', { name })；缺失键回退英文
function t(key, vars) {
  const d = DICT[appLanguage] || DICT.en;
  let s = d[key] || DICT.en[key] || key;
  for (const [k, v] of Object.entries(vars || {})) s = s.split('{{' + k + '}}').join(String(v));
  return s;
}

module.exports = { setLanguage, t };
