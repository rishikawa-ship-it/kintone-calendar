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
  var BASE_URL = 'https://anthropicai-bgi.github.io/kintone-calendar';
  var V = Date.now(); // キャッシュバスター（常に最新を取得）

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
