# API — 数据模型、云函数契约、页面路由

> 与 `REQ.md` 配对使用。所有字段名、类型、错误码以此为准；改动必须同步本文件。

## 1. 云开发环境

| 项 | 值 |
| --- | --- |
| 云函数 | 单个 `news`（action 路由），超时 60s，内存 256MB |
| 运行时 | Node 18 |
| 环境变量 | `ENV_ID`（云开发环境 ID）、`ADMIN_TOKEN`（种子/维护操作口令） |
| 定时触发器 | `FETCH_CRON`（见 REQ §1）调用 `action=fetch` |
| 数据库权限 | 所有集合：**所有用户可读、仅管理端可写** |

## 2. 集合

### 2.1 `news`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 是 | 自动 |
| `title` | string | 是 | ≤ `TITLE_MAX` |
| `url` | string | 是 | 原文链接（绝对地址） |
| `url_hash` | string | 是 | sha1(规范化 url)，唯一索引 |
| `source_id` | string | 是 | 对应 `sources.id` |
| `source_name` | string | 是 | 冗余展示 |
| `category` | string | 是 | `finance` / `policy` / `world` / `hangzhou` / `general` |
| `published_at` | Date | 是 | 缺失时等于 `fetched_at` |
| `fetched_at` | Date | 是 | 抓取时间 |
| `day` | string | 是 | `YYYY-MM-DD`（Asia/Shanghai） |
| `summary` | string | 是 | 纯文本，≤ `SUMMARY_MAX`，可为空串 |
| `content_html` | string | 是 | 清洗后 HTML，≤ `CONTENT_MAX_BYTES`，可为空串 |
| `cover` | string | 否 | 封面图 URL |
| `event_id` | string | 是 | 事件 ID（trend 条目等于自身 `_id`） |
| `hot_score` | number | 是 | 0–100 整数 |
| `is_trend` | boolean | 是 | 热搜榜条目 |
| `rank` | number | 否 | 热搜排名（`is_trend=true` 时有值） |
| `hot_value` | number | 否 | 平台热度值（可空） |
| `tags` | string[] | 是 | 惠民标签，默认 `[]` |
| `source_count` | number | 是 | 同事件报道源数（聚类后回写，默认 1） |
| `source_weight` | number | 是 | 来源权重（内部字段，用于详情页同事件报道排序） |
| `is_primary` | boolean | 是 | 是否该事件在列表中的代表条目（每个 `event_id` 仅一条为 true，D-16） |
| `issuer` | string | 否 | 发文机关 |
| `doc_no` | string | 否 | 文号 |

索引：`url_hash`（唯一）、`day + is_trend + is_primary + category + published_at`、`day + is_trend + is_primary + hot_score`、`day + is_trend + rank`、`event_id`、`published_at`。

### 2.2 `events`

`_id`、`day`、`title`、`category`、`source_count`、`hot_score`、`news_ids[]`、`first_seen_at`、`cover`。
索引：`day + hot_score`。

### 2.3 `sources`

种子数据来自 `SOURCES.yaml`，字段：`_id`、`id`、`name`、`adapter`（`rss`/`json`/`html`/`trend`）、`url`、`linkMatch`、`category`、`kind`（`news`/`trend`）、`weight`、`enabled`、`verified`、`issuer`、`fail_count`、`last_fetch_at`、`disabled_reason`。
索引：`id`（唯一）、`enabled`。

### 2.4 `daily_hot`

`_id`、`date`、`rank`、`news_id`、`event_id`、`hot_score`、`prev_rank`、`change`（`new/up/down/same`）、`delta`（整数，up/down 时为正负数）。
索引：`date + rank`（唯一）。

### 2.5 `fetch_logs`

`_id`、`run_at`、`mode`（`full`/`incr`）、`source_id`、`status`（`ok`/`fail`/`timeout`/`skipped`/`structure_changed`）、`item_count`、`duration_ms`、`error`。
索引：`run_at`、`source_id + run_at`。

### 2.6 `config`

- `_id = "tag_rules"`：`{ rules: [{tag: string, keywords: string[]}], updated_at }`
- `_id = "refresh_lock"`：`{ last_run_at: Date }`

### 2.7 `events_log`

`_id`、`event`、`page`、`payload`（对象）、`ts`、`openid`（可空）。

## 3. 云函数契约

统一响应：

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": { "code": "E_PARAM", "message": "keyword is required" } }
```

### 3.1 `action` 一览

| action | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `listNews` | `{day?, category?, tag?, page?, pageSize?, fallback?}` | `{items: NewsItem[], total, hasMore, day, updatedAt, page, pageSize, fallback, requestedDay?}` | R-08 / R-18 |
| `getTrends` | `{day?}` | `{day, items: TrendItem[]}` | R-09 |
| `getNews` | `{id}` | `{news: NewsDetail, related: NewsItem[]}` | R-10 |
| `search` | `{keyword, range?, page?, pageSize?}` | `{items: NewsItem[], total, hasMore, keyword, range, page, pageSize}` | R-11 |
| `getHot` | `{day?}` | `{day, items: HotItem[]}` | R-07 |
| `getCalendar` | `{month}` | `{month, days: string[], counts: Record<string, number>, minDay, maxDay}` | R-12 |
| `refresh` | `{}` | `{added, updated, skipped, nextAllowedAt}` | R-13 |
| `fetch` | `{mode?, hours?}` | `{added, updated, skipped, failed: string[], clusters, hot, mode, day, durationMs, sources}` | 定时触发，仅内部调用 |
| `cleanup` | `{}` | `{removed: {news, events, daily_hot, fetch_logs}}` | 定时触发，保留 `RETENTION_DAYS` 天 |
| `track` | `{event, page?, payload?}` | `{event, logged}` | R-17 埋点写入 `events_log` |
| `seedSources` | `{adminToken}` | `{inserted, updated, total, tagRules, verified}` | 导入 `SOURCES.yaml`，仅维护时调用 |
| `bootstrap` | `{adminToken?}` | `{created: string[], seeded: {...}}` | D-17 一次性初始化：建 7 个集合 + 导入种子；未配 `ADMIN_TOKEN` 时仅允许空库首次执行 |

### 3.2 结构定义

```ts
type NewsItem = {
  id: string; title: string; sourceName: string; category: string;
  publishedAt: number; summary: string; cover?: string;
  tags: string[]; sourceCount: number; hotScore: number;
  issuer?: string; docNo?: string;
};
type NewsDetail = NewsItem & { url: string; contentHtml: string; eventId: string; fetchedAt: number };
type TrendItem = { rank: number; title: string; url: string; hotValue?: number };
type HotItem = NewsItem & { rank: number; change: 'new'|'up'|'down'|'same'; delta: number };
```

### 3.3 行为约束

1. 所有时间字段以 **毫秒时间戳** 返回给前端，前端负责格式化。
2. `fetch` 仅接受定时触发器调用：`event.Type === 'Timer'`（`TriggerName` 映射：`fetchDaily → fetch`、`cleanupDaily → cleanup`），或带 `ADMIN_TOKEN` 的内部调用；拒绝其他来源。
3. `seedSources` 校验 `adminToken === process.env.ADMIN_TOKEN`，不匹配返回 `E_FORBIDDEN`。
4. 所有写操作在云函数内完成；前端不得调用 `db.collection().add/update/remove`。
5. 单次 `listNews` 最多返回 50 条（`pageSize > 50` 时截断）。
6. 云函数内部全程用 `try/catch`，未知异常返回 `E_INTERNAL`，不抛出原始堆栈给前端。
7. `refresh` 限频期内返回 `E_RATE_LIMIT`，`error.nextAllowedAt` 为可再次刷新的毫秒时间戳。
8. `listNews` 仅在 `fallback=true` 且请求的是「今天」且今天无数据时，回退到最近 3 天内有数据的一天；此时 `fallback=true`、`requestedDay` 为原请求日（D-13）。

## 4. 页面路由

| 路由 | 页面 | 依赖 action | 说明 |
| --- | --- | --- | --- |
| `/pages/news/home/index` | 热点（第 4 个 Tab） | `listNews` + `getTrends` + `getHot` + `search` | 分段：今日 / 热榜 / 搜索；热搜区、下拉刷新 |
| `/pages/news/detail/index?id=` | 详情 | `getNews` | 正文、同事件报道、复制/分享 |
| `/pages/news/archive/index?date=` | 归档 | `getCalendar` + `listNews` | 月历 + 当日列表，从今日页日期条进入 |

## 5. 错误码

| 码 | HTTP 语义 | 触发 | 前端处理 |
| --- | --- | --- | --- |
| `E_PARAM` | 400 | 参数缺失/非法 | 静默回退默认值 |
| `E_NOT_FOUND` | 404 | 条目不存在 | "内容已失效" |
| `E_RATE_LIMIT` | 429 | 刷新冷却中 | 提示剩余分钟数 |
| `E_SOURCE` | 502 | 源抓取失败（单源） | 不展示，仅日志 |
| `E_INTERNAL` | 500 | 未捕获异常 | "服务暂时不可用" + 重试 |
| `E_FORBIDDEN` | 403 | 非定时调用 `fetch` | 不展示 |

## 6. 缓存策略

| 层 | 键 | TTL | 说明 |
| --- | --- | --- | --- |
| 前端 Storage | `list:{day}:{category}:{tag}:{page}` | 5 min | 切换 Tab 复用 |
| 前端 Storage | `trend:{day}` | 30 min | 热搜区 |
| 云函数 | 无 | — | 数据量小，直接查库 |

## 7. 部署清单

1. 创建云开发环境，记录 `ENV_ID`。
2. **云函数配置**：推荐运行时 `Nodejs18.15`（`cheerio`/全局 `fetch` 需要 Node 18+）、超时 `60s`、内存 `256MB`；这些值需在云开发控制台设置，CLI 部署不会带上。若运行时无法修改（当前环境即 Nodejs16.13），代码已做兼容：`cheerio` 固定 `1.0.0-rc.12`、`fetch` 用 `node-fetch@2` 兜底（D-18）。
3. 建 7 个集合与索引（见 §2）；也可在函数部署后调用 `action=bootstrap` 一次完成建集合 + 导入种子（D-17）。
4. 上传 `cloudfunctions/news`（`cli cloud functions deploy --env <ENV_ID> --names news --remote-npm-install`），配置 `ADMIN_TOKEN`。
5. 添加定时触发器 `FETCH_CRON` 与清理任务。
6. 运行 `seedSources`（`TASKS.md T-03`）导入 `SOURCES.yaml`。
7. 小程序端改 `app.js` 中 `env` 为 `ENV_ID`。

> 排查提示：客户端把云函数调用失败分为三类——`-501000 FUNCTION_NOT_FOUND`（未部署）、`-504002/-504003`（执行崩溃或超时）、其他（网络）。
