# tg-quark-collector

定时从 Telegram 频道拉夸克网盘分享链接，直接写入 Supabase PostgreSQL。Flutter App 直连 Supabase REST API 搜索。

## 架构

```
GitHub Actions（每2小时）
  → GramJS 拉 TG 频道消息
  → 提取夸克链接 + 标题
  → 新 URL 批量 POST 插入 Supabase
  → 已存在但标题变了 并发 PATCH 更新
Supabase
  → Flutter App 直连 REST API 搜索
```

## 一次性准备

### 1. 申请 TG API 凭证

去 https://my.telegram.org → API development tools，填个应用名，拿到：
- `api_id`（数字）
- `api_hash`（字符串）

### 2. 本地登录拿 session

本地需要挂代理（能访问 TG），然后：

```bash
npm install
$env:TG_API_ID="你的api_id"
$env:TG_API_HASH="你的api_hash"
$env:SOCKS_PROXY_PORT="7897"   # 你的代理端口
node login.js
```

按提示输入手机号、验证码。成功后输出 session 字符串，复制下来。

### 3. Supabase 建表

在 Supabase SQL Editor 执行：

```sql
create table items (
  id bigint generated always as identity primary key,
  title text not null,
  url text not null unique,
  password text default '',
  source text default '',
  created_at timestamptz default now()
);

-- 模糊搜索索引
create extension if not exists pg_trgm;
create index idx_items_title on items using gin (title gin_trgm_ops);

-- 关闭 RLS（Flutter 直连用 anon key）
alter table items disable row level security;
```

### 4. GitHub Secrets

仓库 **Settings → Secrets and variables → Actions → New repository secret**，加六个：

| Secret | 值 |
|---|---|
| `TG_API_ID` | 第一步的 api_id |
| `TG_API_HASH` | 第一步的 api_hash |
| `TG_SESSION` | 第二步输出的 session 字符串 |
| `TG_CHANNELS` | 逗号分隔，如 `mqte5,Quark_Movies` |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_SECRET_KEY` | Supabase secret key |

### 5. 跑

Actions 页面手动点 `Run workflow`，或等每 2 小时自动跑。

## 数据格式

Supabase 表 `items`：

| 字段 | 说明 |
|---|---|
| `id` | 自增主键 |
| `title` | 资源标题（清洗后） |
| `url` | 夸克分享链接（unique） |
| `password` | 提取码（如有） |
| `source` | 来源频道 |
| `created_at` | 消息时间 |

## Flutter 搜索 API

```
GET {SUPABASE_URL}/rest/v1/items
  ?title=ilike.*关键词*
  &select=id,title,url,password,source,created_at
  &order=created_at.desc
  &limit=20&offset=0
Headers:
  apikey: {publishable_key}
  Authorization: Bearer {publishable_key}
  Prefer: count=exact
```

## 去重逻辑

- 启动时从 Supabase 分页拉取所有 URL → title 映射
- URL 不存在 → 新增
- URL 存在但标题变了（如剧集从"1-5集"更新到"1-7集"）→ PATCH 更新标题
- URL 存在且标题相同 → 跳过

## 找频道

在 TG 里搜关键词：`夸克网盘`、`夸克分享`、`网盘资源`、`quark`，挑更新活跃的频道名填进 `TG_CHANNELS`。
