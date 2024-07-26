// Webサーバのライブラリ: Express
import express from 'express';
import crypto from 'crypto';

// 環境変数の定義を.envファイルから読み込む（開発用途用）
import dotenv from 'dotenv';

import { LineApi } from './line-api.mjs';
import { DataStore } from './data-store.mjs';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { readFileSync } from 'fs';

// .envファイル空環境変数を読み込み
dotenv.config();
// LINEのチャネルシークレットをCHANNEL_SECRET環境変数から読み込み
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// expressの初期化
const app = express();
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf
  }
}));
// TCP/8080ポートでサーバを起動
app.listen(8080);

const lineApi = new LineApi(CHANNEL_ACCESS_TOKEN);
const datastore = new DataStore();

// ルートのエンドポイント定義
// レスポンスがきちんと返せているかの確認用
app.get('/', (request, response) => {
  response.status(200).send('Hello');
});

app.get('/numbers', async (request, response, buf) => {
  const template = readFileSync('numbers.html').toString();
  const saved_numbers = (await datastore.load_global())['saved_numbers'];
  const html = template.replace("$NUMBERS", saved_numbers && `[${saved_numbers?.join(",")}]`);
  console.log(html);
  response.status(200).send(html);
});

// webhookを受け取るエンドポイントを定義
// POST /webhook
app.post('/webhook', (request, response, buf) => {
  // https://developers.line.biz/ja/docs/messaging-api/receiving-messages/

  // 受け取ったwebhookのイベント
  const body = request.body;
  // デバッグ用として出力
  console.log(body);

  // 署名検証（全くの第三者がリクエストを送ってきたときの対策＝なくても動くが本番環境では大事）
  if (!verifySignature(request.rawBody, request.headers['x-line-signature'], CHANNEL_SECRET)) {
    response.status(401).send({});
    return;
  }

  // 到着したイベントのevents配列から取りだし
  body.events.forEach(async (event) => {
    switch (event.type) {
      case 'message':　// event.typeがmessageのとき応答
        if (event.source.type == "user") {
          const userId = event.source.userId;

          // BOTの手を選ぶ
          const botHand = ["グー", "チョキ", "パー"][Math.floor(Math.random() * 3)];
          const userHand = event.message.text;

          // 勝ち負け判定
          const result = judge(botHand, userHand)

          // 戦績を保存
          const state = await datastore.load(userId);
          await datastore.save(userId, {
            results: [
              {
                result,
                botHand,
                userHand,
                creaedAt: formatDate(Date.now()),
              },
              ...(state['results'] ?? []),
            ],
          });
          
          // 返信
          await lineApi.replyMessage(
            event.replyToken,
            createReplyText(result, botHand),
          );
        }
        break;
    }
  });

  response.status(200).send({});
});

function createReplyText(result, botHand) {
  const handEmoji = {
    'グー': '✊',
    'チョキ': '✌️',
    'パー': '🖐️'
  };

  const baseMessage = `BOTの手は${handEmoji[botHand]}${botHand}でした！\n`;

  switch (result) {
    case "勝ち":
      return baseMessage + "あなたの勝ちです！🎉 さすがですね！";
    case "負け":
      return baseMessage + "BOTの勝ちです！😆 次は勝てるかな？";
    case "引き分け":
      return baseMessage + "引き分けです！😮 もう一回勝負しましょう！";
    default:
      return "手は「グー」「チョキ」「パー」の中から選んでね！";
  }
}

function judge(myHand, otherHand) {
  const validHands = ['グー', 'チョキ', 'パー'];
  const winCombos = {
    'グー': 'チョキ',
    'チョキ': 'パー',
    'パー': 'グー'
  };

  // 有効な手かどうかをチェック
  if (!validHands.includes(myHand) || !validHands.includes(otherHand)) {
    return null;
  }

  if (myHand === otherHand) return "引き分け";
  return winCombos[myHand] === otherHand ? "勝ち" : "負け";
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}年${month}月${day}日 ${hours}:${minutes}:${seconds}`;
}

// webhookの署名検証
// https://developers.line.biz/ja/reference/messaging-api/#signature-validation
function verifySignature(body, receivedSignature, channelSecret) {
  const signature = crypto
    .createHmac("SHA256", channelSecret)
    .update(body)
    .digest("base64");
  return signature === receivedSignature;
}