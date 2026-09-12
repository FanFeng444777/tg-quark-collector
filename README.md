# tg-quark-collector

定时从 Telegram 频道拉夸克网盘分享链接，存成 `data/quark.json`。

## 一次性准备

### 1. 申请 TG API 凭证

去 https://my.telegram.org → API development tools，填个应用名，拿到：
- `api_id`（数字）
- `api_hash`（字符串）

### 2. 本地登录拿 session

本地需要挂代理（能访问 TG），然后：

```bash
npm install
set TG_API_ID=你的api_id
set TG_API_HASH=你的api_hash
node login.js
```

按提示输入手机号、验证码。成功后会输出一大串 session 字符串，复制下来。

### 3. 建 GitHub 仓库，配 Secrets

把本项目推到 GitHub（**建议公开仓库**，Actions 分钟数无限）。

仓库 **Settings → Secrets and variables → Actions → New repository secret**，加四个：

| Secret | 值 |
|---|---|
| `TG_API_ID` | 第一步的 api_id |
| `TG_API_HASH` | 第一步的 api_hash |
| `TG_SESSION` | 第二步输出的 session 字符串 |
| `TG_CHANNELS` | 逗号分隔的频道名，如 `quark_share,https://t.me/another_channel` |

### 4. 跑

Actions 页面手动点一次 `Run workflow`，或等每 2 小时自动跑。

跑完后 `data/quark.json` 里就是全部采集到的链接。

## 数据格式

```json
[
  {
    "title": "资源标题",
    "url": "https://pan.quark.cn/s/xxx",
    "password": "8888",
    "source": "tg:频道名",
    "datetime": "2026-09-12T00:00:00.000Z"
  }
]
```

## 找频道

在 TG 里搜关键词：`夸克网盘`、`夸克分享`、`网盘资源`、`quark`，能找到一堆公开频道。
挑更新活跃的，把用户名（`@xxx` 或 `https://t.me/xxx`）填进 `TG_CHANNELS`。
