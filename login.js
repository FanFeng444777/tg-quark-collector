// 首次登录：本地挂代理跑一次，把输出的 session 字符串存到 GitHub Secret TG_SESSION
// 用法：node login.js
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import readline from "node:readline";

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;

if (!apiId || !apiHash) {
  console.error("请先设置环境变量 TG_API_ID 和 TG_API_HASH");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

const session = new StringSession("");
const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

await client.start({
  phoneNumber: async () => await ask("手机号(+86138...): "),
  password: async () => await ask("两步验证密码(没有就直接回车): "),
  phoneCode: async () => await ask("收到的验证码: "),
  onError: (e) => console.error(e),
});

console.log("\n===== 登录成功，把下面这串存到 GitHub Secret TG_SESSION =====");
console.log(session.save());
console.log("===========================================================\n");
await client.disconnect();
process.exit(0);
