/**
 * kintone カレンダー ローダースクリプト
 *
 * このファイルを kintone のカスタマイズJS に1回だけアップロードしてください。
 * 本体の JS/CSS は GitHub Pages から動的に読み込みます。
 *
 * ★ BASE_URL を GitHub Pages の公開URLに変更してください。
 */
(function () {
  'use strict';

  // ===== 設定 =====
  var BASE_URL = 'https://rishikawa-ship-it.github.io/kintone-calendar';
  // キャッシュバスター（固定版数文字列）
  // 本体 JS/CSS を更新してデプロイする際はこの値を新しいものに手動更新すること
  // 例: '2026-05-13-perf1' → '2026-06-01-v2' のように日付＋識別子で更新する
  var V = '2026-05-13-perf1';

  // ===== CSS 読み込み =====
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = BASE_URL + '/kc-calendar.css?v=' + V;
  document.head.appendChild(link);

  // ===== JS 読み込み =====
  var script = document.createElement('script');
  script.src = BASE_URL + '/kc-calendar.js?v=' + V;
  script.async = false;
  document.head.appendChild(script);
})();
