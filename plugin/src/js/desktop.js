// TODO: Phase 3 で実装
// src/kc-calendar.js を基に以下の変更を行う:
// - IIFE を (function(PLUGIN_ID) { ... })(kintone.$PLUGIN_ID); 形式に変更
// - 起動時に kintone.plugin.app.getConfig(PLUGIN_ID) で設定値を取得
// - 設定値が存在する場合は KC.Config.FIELD に上書き
// - 設定値が存在しない場合は KC.Config.detectFields() フォールバックを使用
// 詳細は requirements/REQ_plugin-migration.md §3 Phase 3 を参照
