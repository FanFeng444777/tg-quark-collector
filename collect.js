// GitHub Actions：拉 TG 频道消息 → 写入 Supabase
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const sessionStr = process.env.TG_SESSION;
const channels = (process.env.TG_CHANNELS || "").split(",").map((s) => s.trim()).filter(Boolean);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!apiId || !apiHash || !sessionStr) {
  console.error("缺少 TG_API_ID / TG_API_HASH / TG_SESSION");
  process.exit(1);
}
if (!channels.length) {
  console.error("未配置 TG_CHANNELS");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SECRET_KEY");
  process.exit(1);
}

const QUARK_RE = /https?:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)(?:\?pwd=([a-zA-Z0-9]+))?/g;
const PWD_RE = /(?:提取码|密码|pwd)[：:\s]*([a-zA-Z0-9]{4})/i;

// 从 Supabase 拉已有 URL 做去重
console.log("拉取已有数据...");
const existingMap = new Map(); // url -> title
let offset = 0;
while (true) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/items?select=url,title&limit=1000&offset=${offset}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const batch = await res.json();
  if (!Array.isArray(batch) || batch.length === 0) break;
  batch.forEach((r) => existingMap.set(r.url, r.title));
  if (batch.length < 1000) break;
  offset += 1000;
}
console.log(`Supabase 已有 ${existingMap.size} 条`);

const proxyOpts = process.env.SOCKS_PROXY_PORT
  ? {
      proxy: {
        socksType: 5,
        ip: process.env.SOCKS_PROXY_HOST || "127.0.0.1",
        port: Number(process.env.SOCKS_PROXY_PORT),
      },
    }
  : {};

const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
  connectionRetries: 5,
  ...proxyOpts,
});
await client.connect();

const newItems = [];
const isFirstRun = true; // 临时：强制拉 5000 条

for (const ch of channels) {
  try {
    const entity = await client.getEntity(ch);
    const fetchLimit = isFirstRun ? 5000 : 100;
    const messages = await client.getMessages(entity, { limit: fetchLimit });
    console.log(`[${ch}] 拉到 ${messages.length} 条消息`);

    for (const msg of messages) {
      const text = msg.message || "";

      // 过滤广告消息
      if (/(能量闪租|TRX|USDT|闪兑|VIEW BOT|广告|推广|兼职|刷单|日赚|月入)/i.test(text)) continue;

      // 收集这条消息里所有夸克链接：文本里的 + 内联按钮里的
      const links = [];
      let m;
      QUARK_RE.lastIndex = 0;
      while ((m = QUARK_RE.exec(text)) !== null) {
        links.push(`https://pan.quark.cn/s/${m[1]}`);
      }
      // 从内联按钮提取（如 seedhub_chat 频道）
      const buttons = msg.replyMarkup?.rows?.flatMap((r) => r.buttons) || [];
      for (const btn of buttons) {
        if (btn.url && btn.url.includes("quark")) {
          console.log("按钮URL:", btn.text, "→", btn.url);
          const bm = btn.url.match(/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/);
          if (bm) links.push(`https://pan.quark.cn/s/${bm[1]}`);
        }
      }
      if (links.length === 0) continue;

      // 标题提取：优先"名称："格式，否则取第一行（去掉标签行、主演行等）
      let titleRaw = "";
      const nameMatch = text.match(/名称[：:]([\s\S]*?)(?:描述[：:]|简介[：:]|夸克[：:]|链接[：:]|大小[：:]|标签[：:]|$)/);
      if (nameMatch) {
        titleRaw = nameMatch[1];
      } else {
        // 取第一行非标签、非主演的标题
        titleRaw = text
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l && !l.startsWith("#") && !l.startsWith("主演") && !l.startsWith("导演") && !l.startsWith("豆瓣") && !l.startsWith("影片") && !l.startsWith("简介") && !l.startsWith("描述")) || text.split("\n")[0];
      }

      const title = titleRaw
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .replace(/^[\s\[\]【】()（）#*\-•·|：:]+/, "")
        .replace(/[：:]\s*$/, "")
        .slice(0, 120)
        .trim();

      for (const url of links) {
        let password = "";
        const pm = text.match(PWD_RE);
        if (pm) password = pm[1];

        // 去重：URL 不存在 或 URL 存在但标题变了（如剧集更新），都加入待写入
        const isNew = !existingMap.has(url);
        const oldTitle = existingMap.get(url);
        if (oldTitle === title) continue;
        existingMap.set(url, title);

        newItems.push({
          title: title || "(无标题)",
          url,
          password,
          source: `tg:${ch.replace(/^https?:\/\/t\.me\//, "")}`,
          created_at: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
          _isNew: isNew,
        });
      }
    }
  } catch (e) {
    console.error(`[${ch}] 失败: ${e.message}`);
  }
}

await client.disconnect();

// 分批写入 Supabase
if (newItems.length > 0) {
  const toInsert = newItems.filter((i) => i._isNew).map(({ _isNew, ...rest }) => rest);
  const toUpdate = newItems.filter((i) => !i._isNew).map(({ _isNew, ...rest }) => rest);

  const BATCH = 500;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // 新 URL：POST 插入
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    console.log(`插入 ${batch.length} 条新数据...`);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/items`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      console.error("插入失败:", res.status, await res.text());
      process.exit(1);
    }
  }

  // 已存在 URL：批量并发更新标题（每批 20 个）
  const CONCURRENCY = 20;
  let updated = 0, failed = 0;
  for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
    const batch = toUpdate.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (item) => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/items?url=eq.${encodeURIComponent(item.url)}`, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({ title: item.title, password: item.password }),
        });
        if (res.ok) updated++;
        else { failed++; console.error("更新失败:", res.status); }
      } catch (e) {
        failed++;
      }
    }));
  }

  console.log(`完成：新增 ${toInsert.length}，更新 ${updated}，失败 ${failed}`);
} else {
  console.log("无新数据");
}
