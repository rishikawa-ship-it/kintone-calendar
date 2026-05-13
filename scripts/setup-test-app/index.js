'use strict';

const path = require('path');
const fs = require('fs');

// .env を読み込む（dotenv がなければ自前パーサにフォールバック）
loadEnv(path.join(__dirname, '.env'));

const { KintoneRestAPIClient } = require('@kintone/rest-api-client');

// ポーリング設定
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;

/**
 * .env ファイルを読み込み、process.env に展開するシンプルなパーサ。
 * dotenv が利用可能な場合は dotenv を優先する。
 * @param {string} envPath - .env ファイルのパス
 */
function loadEnv(envPath) {
  try {
    // dotenv が依存関係にあれば使う
    const dotenv = require('dotenv');
    dotenv.config({ path: envPath });
  } catch (_) {
    // dotenv 未インストール時は自前パーサで代替
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  }
}

/**
 * 必須環境変数の存在チェック。未設定の場合は即座に終了する。
 * @param {string[]} keys - 必須の環境変数名一覧
 */
function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error('[ERROR] 以下の環境変数が設定されていません: ' + missing.join(', '));
    console.error('        .env.example をコピーして .env を作成し、値を入力してください。');
    process.exit(1);
  }
}

/**
 * kintone アプリのデプロイ完了をポーリングして待機する。
 * POLL_TIMEOUT_MS を超えてもステータスが SUCCESS にならない場合は例外を投げる。
 * @param {KintoneRestAPIClient} client - REST API クライアント
 * @param {number} appId - アプリ ID
 * @returns {Promise<void>}
 */
async function waitForDeploy(client, appId) {
  const start = Date.now();
  while (true) {
    const elapsed = Date.now() - start;
    if (elapsed > POLL_TIMEOUT_MS) {
      throw new Error('デプロイのタイムアウト (' + POLL_TIMEOUT_MS / 1000 + '秒) に達しました。kintone 管理画面でデプロイ状況を確認してください。');
    }

    const result = await client.app.getDeployStatus({ apps: [appId] });
    const status = result.apps[0] && result.apps[0].status;

    if (status === 'SUCCESS') {
      return;
    }
    if (status === 'FAIL') {
      throw new Error('デプロイが FAIL ステータスで終了しました。kintone 管理画面でエラー内容を確認してください。');
    }

    console.log('  デプロイ中... (経過: ' + Math.round(elapsed / 1000) + '秒, 状態: ' + status + ')');
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * テストアプリセットアップのメイン処理。
 *
 * 1. 環境変数を検証する
 * 2. fields-config.{variant}.json を読み込む
 * 3. KintoneRestAPIClient を初期化する
 * 4. addFormFields でフィールドを追加する (preview 環境)
 * 5. deployApp でデプロイを開始する
 * 6. getDeployStatus をポーリングしてデプロイ完了を待つ
 * 7. 完了ログを表示する
 *
 * @returns {Promise<void>}
 */
async function main() {
  // --- 1. 環境変数の検証 ---
  requireEnv(['KINTONE_BASE_URL', 'KINTONE_API_TOKEN', 'KINTONE_APP_ID']);

  const baseUrl = process.env.KINTONE_BASE_URL.replace(/\/$/, '');
  const apiToken = process.env.KINTONE_API_TOKEN;
  const appId = Number(process.env.KINTONE_APP_ID);
  const variant = process.env.KC_FIELDS_VARIANT || 'datetime';

  if (!Number.isInteger(appId) || appId <= 0) {
    console.error('[ERROR] KINTONE_APP_ID は正の整数である必要があります: ' + process.env.KINTONE_APP_ID);
    process.exit(1);
  }

  if (variant !== 'datetime' && variant !== 'date') {
    console.error('[ERROR] KC_FIELDS_VARIANT は "datetime" または "date" を指定してください: ' + variant);
    process.exit(1);
  }

  // --- 2. fields-config の読み込み ---
  const configPath = path.join(__dirname, 'fields-config.' + variant + '.json');
  if (!fs.existsSync(configPath)) {
    console.error('[ERROR] フィールド設定ファイルが見つかりません: ' + configPath);
    process.exit(1);
  }

  let fieldsConfig;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    fieldsConfig = JSON.parse(raw);
  } catch (e) {
    console.error('[ERROR] フィールド設定ファイルの読み込みに失敗しました:', e.message);
    process.exit(1);
  }

  const properties = fieldsConfig.properties;
  if (!properties || typeof properties !== 'object') {
    console.error('[ERROR] フィールド設定ファイルに "properties" キーがありません: ' + configPath);
    process.exit(1);
  }

  console.log('--- kintone テストアプリセットアップ ---');
  console.log('対象アプリ ID   : ' + appId);
  console.log('フィールド構成  : ' + variant);
  console.log('追加フィールド数: ' + Object.keys(properties).length);
  console.log('');

  // --- 3. KintoneRestAPIClient の初期化 ---
  const client = new KintoneRestAPIClient({
    baseUrl: baseUrl,
    auth: { apiToken: apiToken },
  });

  // --- 4. フィールド追加 (preview 環境) ---
  console.log('[1/3] フィールドを追加しています...');
  try {
    await client.app.addFormFields({
      app: appId,
      properties: properties,
    });
    console.log('      フィールド追加完了');
  } catch (e) {
    // 重複フィールドコードの場合は分かりやすいメッセージを表示
    if (e.message && e.message.includes('code')) {
      console.error('[ERROR] フィールド追加に失敗しました。');
      console.error('        既に同じフィールドコードが存在する可能性があります。');
      console.error('        kintone 管理画面でフォームを確認し、重複するフィールドを削除してから再実行してください。');
      console.error('        詳細: ' + e.message);
    } else {
      console.error('[ERROR] フィールド追加に失敗しました:', e.message);
    }
    console.error(e.stack || e);
    process.exit(1);
  }

  // --- 5. デプロイ開始 ---
  console.log('[2/3] デプロイを開始しています...');
  try {
    await client.app.deployApp({
      apps: [{ app: appId, revision: -1 }],
    });
    console.log('      デプロイ開始');
  } catch (e) {
    console.error('[ERROR] デプロイ開始に失敗しました:', e.message);
    console.error(e.stack || e);
    process.exit(1);
  }

  // --- 6. デプロイ完了待機 ---
  console.log('[3/3] デプロイ完了を待機しています (最大 ' + POLL_TIMEOUT_MS / 1000 + '秒)...');
  try {
    await waitForDeploy(client, appId);
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    process.exit(1);
  }

  // --- 7. 完了 ---
  console.log('');
  console.log('セットアップが完了しました。');
  console.log('アプリ URL: ' + baseUrl + '/k/' + appId + '/');
}

main().catch((e) => {
  console.error('[FATAL] 予期しないエラーが発生しました:', e);
  process.exit(1);
});
