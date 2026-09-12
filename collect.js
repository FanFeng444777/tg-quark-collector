// GitHub Actions 里跑：拉 TG 频道消息，正则提取夸克链接，合并去重后写 data/quark.json
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const sessionStr = process.env.TG_SESSION;
// 逗号分隔的频道用户名或链接，如: "some_channel,https://t.me/another_channel"
const channels = (process.env.TG_CHANNELS || "").split(",").map((s) => s.trim()).filter(Boolean);

const DATA_FILE = new URL("./data/quark.json", import.meta.url);

if (!apiId || !apiHash || !sessionStr) {
  console.error("缺少 TG_API_ID / TG_API_HASH / TG_SESSION");
  process.exit(1);
}
if (!channels.length) {
  console.error("未配置 TG_CHANNELS");
  process.exit(1);
}

// 读已有数据
let items = [];
if (existsSync(DATA_FILE)) {
  items = JSON.parse(readFileSync(DATA_FILE, "utf8"));
}
const seen = new Set(items.map((i) => i.url));
const before = items.length;

const QUARK_RE = /https?:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)(?:\?pwd=([a-zA-Z0-9]+))?/g;
const PWD_RE = /(?:提取码|密码|pwd)[：:\s]*([a-zA-Z0-9]{4})/i;

const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
  connectionRetries: 5,
});
await client.connect();

for (const ch of channels) {
  try {
    const entity = await client.getEntity(ch);
    // 每次拉最近 200 条，靠 url 去重
    const messages = await client.getMessages(entity, { limit: 4000 });
    console.log(`[${ch}] 拉到 ${messages.length} 条消息`);

    for (const msg of messages) {
      const text = msg.message || "";
      if (!text.includes("quark.cn")) continue;

      let m;
      QUARK_RE.lastIndex = 0;
      while ((m = QUARK_RE.exec(text)) !== null) {
        const url = `https://pan.quark.cn/s/${m[1]}`;
        if (seen.has(url)) continue;
        seen.add(url);

        let password = m[2] || "";
        if (!password) {
          const pm = text.match(PWD_RE);
          if (pm) password = pm[1];
        }

        // 标题取消息第一行，去掉开头的 emoji/符号
        const title = text
          .split("\n")[0]
          .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
          .replace(/^[\s\[\]【】()（）#*\-•·|]+/, "")
          .slice(0, 120)
          .trim();

        items.push({
          title: title || "(无标题)",
          url,
          password,
          source: `tg:${ch.replace(/^https?:\/\/t\.me\//, "")}`,
          datetime: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    console.error(`[${ch}] 失败: ${e.message}`);
  }
}

await client.disconnect();

// 按时间倒序写回
items.sort((a, b) => (a.datetime < b.datetime ? 1 : -1));
mkdirSync(new URL("./data", import.meta.url), { recursive: true });
writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));

console.log(`\n入库前: ${before}  入库后: ${items.length}  本次新增: ${items.length - before}`);
