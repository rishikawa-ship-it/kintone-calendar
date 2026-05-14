'use strict';

const path = require('path');
const fs = require('fs');

// ルートの .env を読み込む（dotenv がなければ自前パーサにフォールバック）
// setup-test-app/index.js と同じパターンでルートを参照する
loadEnv(path.resolve(__dirname, '../../.env'));

const { KintoneRestAPIClient } = require('@kintone/rest-api-client');

// ポーリング設定
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;

// フィールドコードの命名規則（英数字とアンダースコアのみ）
const FIELD_CODE_PATTERN = /^[a-zA-Z0-9_]+$/;

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
 * コマンドライン引数からフィールドコードを取得し、命名規則を検証する。
 * @returns {string[]} 削除対象フィールドコードの配列
 */
function parseFieldCodes() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('[ERROR] 削除対象のフィールドコードを 1 つ以上指定してください。');
    console.error('        使用例: node reset-fields.js userMail account');
    process.exit(1);
  }

  const invalid = args.filter((code) => !FIELD_CODE_PATTERN.test(code));
  if (invalid.length > 0) {
    console.error('[ERROR] フィールドコードに使用できない文字が含まれています: ' + invalid.join(', '));
    console.error('        フィールドコードは英数字とアンダースコアのみ使用できます。');
    process.exit(1);
  }

  return args;
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
 * 削除対象フィールドコードのうち、実際にアプリに存在するものを返す。
 * preview: true で取得することで、未デプロイのフィールドも含めて確認する。
 * @param {KintoneRestAPIClient} client - REST API クライアント
 * @param {number} appId - アプリ ID
 * @param {string[]} targetCodes - 削除対象フィールドコード
 * @returns {Promise<{existingTargets: string[], missingTargets: string[]}>}
 */
async function resolveDeleteTargets(client, appId, targetCodes) {
  const existingFields = await client.app.getFormFields({ app: appId, preview: true });
  const existingCodes = Object.keys(existingFields.properties);

  const existingTargets = targetCodes.filter((code) => existingCodes.includes(code));
  const missingTargets = targetCodes.filter((code) => !existingCodes.includes(code));

  return { existingTargets, missingTargets };
}

/**
 * 指定フィールドを kintone アプリから削除してデプロイするメイン処理。
 *
 * 1. コマンドライン引数を検証する（フィールドコード 1 個以上、命名規則チェック）
 * 2. 環境変数を検証する
 * 3. KintoneRestAPIClient を初期化する
 * 4. 削除対象フィールドが実際に存在するか確認する（存在しないものは警告して継続）
 * 5. 削除対象が 0 件の場合は early return
 * 6. deleteFormFields でフィールドを削除する
 * 7. deployApp でデプロイを開始する
 * 8. getDeployStatus をポーリングしてデプロイ完了を待つ
 * 9. 完了ログを表示する
 *
 * @returns {Promise<void>}
 */
async function main() {
  // --- 1. コマンドライン引数の検証 ---
  const targetCodes = parseFieldCodes();

  // --- 2. 環境変数の検証 ---
  requireEnv(['KINTONE_BASE_URL', 'KINTONE_API_TOKEN', 'KINTONE_APP_ID']);

  const baseUrl = process.env.KINTONE_BASE_URL.replace(/\/$/, '');
  const apiToken = process.env.KINTONE_API_TOKEN;
  const appId = Number(process.env.KINTONE_APP_ID);

  if (!Number.isInteger(appId) || appId <= 0) {
    console.error('[ERROR] KINTONE_APP_ID は正の整数である必要があります: ' + process.env.KINTONE_APP_ID);
    process.exit(1);
  }

  console.log('--- kintone フィールド削除 ---');
  console.log('対象アプリ ID   : ' + appId);
  console.log('削除対象フィールド: ' + targetCodes.join(', '));
  console.log('');

  // --- 3. KintoneRestAPIClient の初期化 ---
  const client = new KintoneRestAPIClient({
    baseUrl: baseUrl,
    auth: { apiToken: apiToken },
  });

  // --- 4. 削除対象フィールドの存在確認 ---
  console.log('[1/3] 既存フィールドを確認しています...');

  let existingTargets;
  let missingTargets;

  try {
    ({ existingTargets, missingTargets } = await resolveDeleteTargets(client, appId, targetCodes));
  } catch (e) {
    console.error('[ERROR] 既存フィールドの取得に失敗しました:', e.message);
    console.error(e.stack || e);
    process.exit(1);
  }

  if (missingTargets.length > 0) {
    console.log('      [WARN] 以下のフィールドはアプリに存在しないためスキップします: ' + missingTargets.join(', '));
  }

  // --- 5. 削除対象が 0 件の場合は early return ---
  if (existingTargets.length === 0) {
    console.log('      削除対象フィールドが見つかりませんでした。処理を終了します。');
    return;
  }

  console.log('      削除対象: ' + existingTargets.join(', ') + ' (' + existingTargets.length + ' 件)');

  // --- 6. フィールド削除 ---
  try {
    await client.app.deleteFormFields({
      app: appId,
      fields: existingTargets,
    });
    console.log('      フィールド削除完了 (' + existingTargets.length + ' 件)');
  } catch (e) {
    console.error('[ERROR] フィールド削除に失敗しました:', e.message);
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
  console.log('フィールド削除が完了しました。');
  console.log('削除済み: ' + existingTargets.join(', '));
  console.log('アプリ URL: ' + baseUrl + '/k/' + appId + '/');
}

main().catch((e) => {
  console.error('[FATAL] 予期しないエラーが発生しました:', e);
  process.exit(1);
});
