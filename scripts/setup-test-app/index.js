'use strict';

const path = require('path');
const fs = require('fs');

// ルートの .env を読み込む（dotenv がなければ自前パーサにフォールバック）
// プラグインアップローダーとテストアプリスクリプトで .env を共有するためルートを参照する
loadEnv(path.resolve(__dirname, '../../.env'));

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
    console.error('        ルートの .env.example をコピーして .env を作成し、値を入力してください。');
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
 * 既存フィールドコードを取得し、追加対象外のコードを除外した properties を返す。
 * preview: true で取得することで、未デプロイのフィールドも含めて確認する。
 * @param {KintoneRestAPIClient} client - REST API クライアント
 * @param {number} appId - アプリ ID
 * @param {Object} configProperties - fields-config の properties オブジェクト
 * @returns {Promise<{newProperties: Object, existingCodes: string[], skippedCodes: string[]}>}
 */
async function resolveNewProperties(client, appId, configProperties) {
  const existingFields = await client.app.getFormFields({ app: appId, preview: true });
  const existingCodes = Object.keys(existingFields.properties);

  const newProperties = Object.fromEntries(
    Object.entries(configProperties).filter(([code]) => !existingCodes.includes(code))
  );

  const skippedCodes = Object.keys(configProperties).filter((code) => existingCodes.includes(code));

  return { newProperties, existingCodes, skippedCodes };
}

/**
 * テストアプリセットアップのメイン処理。
 *
 * 1. 環境変数を検証する
 * 2. fields-config.{variant}.json を読み込む
 * 3. KintoneRestAPIClient を初期化する
 * 4. 既存フィールドコードを取得し、追加対象を絞り込む
 * 5. 追加対象が 0 件の場合はスキップしてデプロイも行わない
 * 6. 追加対象が 1 件以上の場合は addFormFields でフィールドを追加する (preview 環境)
 * 7. deployApp でデプロイを開始する
 * 8. getDeployStatus をポーリングしてデプロイ完了を待つ
 * 9. 完了ログを表示する
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
  console.log('設定フィールド数: ' + Object.keys(properties).length);
  console.log('');

  // --- 3. KintoneRestAPIClient の初期化 ---
  const client = new KintoneRestAPIClient({
    baseUrl: baseUrl,
    auth: { apiToken: apiToken },
  });

  // --- 4. 既存フィールドを確認して追加対象を絞り込む ---
  console.log('[1/3] フィールドを追加しています...');

  let newProperties;
  let existingCodes;
  let skippedCodes;

  try {
    ({ newProperties, existingCodes, skippedCodes } = await resolveNewProperties(client, appId, properties));
  } catch (e) {
    console.error('[ERROR] 既存フィールドの取得に失敗しました:', e.message);
    console.error(e.stack || e);
    process.exit(1);
  }

  if (existingCodes.length > 0) {
    console.log('      既存フィールド検出: ' + existingCodes.join(', '));
  }

  const newCount = Object.keys(newProperties).length;
  const skipCount = skippedCodes.length;

  // --- 5. 追加対象が 0 件の場合はスキップ ---
  if (newCount === 0) {
    console.log('      追加対象: なし (全 ' + skipCount + ' 件が既存)');
    console.log('      追加処理をスキップします。デプロイも不要のため終了します。');
    console.log('');
    console.log('セットアップが完了しました (変更なし)。');
    console.log('アプリ URL: ' + baseUrl + '/k/' + appId + '/');
    return;
  }

  console.log('      追加対象: ' + Object.keys(newProperties).join(', ') + ' (' + newCount + ' 件)');

  // --- 6. フィールド追加 (preview 環境) ---
  try {
    await client.app.addFormFields({
      app: appId,
      properties: newProperties,
    });
    console.log('      フィールド追加完了 (新規 ' + newCount + ' 件 / スキップ ' + skipCount + ' 件)');
  } catch (e) {
    console.error('[ERROR] フィールド追加に失敗しました:', e.message);
    console.error(e.stack || e);
    process.exit(1);
  }

  // --- 7. デプロイ開始 ---
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

  // --- 8. デプロイ完了待機 ---
  console.log('[3/3] デプロイ完了を待機しています (最大 ' + POLL_TIMEOUT_MS / 1000 + '秒)...');
  try {
    await waitForDeploy(client, appId);
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    process.exit(1);
  }

  // --- 9. 完了 ---
  console.log('');
  console.log('セットアップが完了しました。');
  console.log('アプリ URL: ' + baseUrl + '/k/' + appId + '/');
}

main().catch((e) => {
  console.error('[FATAL] 予期しないエラーが発生しました:', e);
  process.exit(1);
});
