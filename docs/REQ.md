# REQ — 每日热点小程序需求规格

> 实现依据。每条需求 = 规则 + 验收断言；断言必须逐条通过。字段与接口见 `API.md`，源配置见 `SOURCES.yaml`，任务见 `TASKS.md`。

## 0. 范围

**做（P0）**：定时抓取、去重聚类、热度排序、首页分类列表、热搜区、热榜 Top10、详情、搜索、归档、手动刷新、杭州惠民标签、政策元信息、分享、抓取日志、异常态。

**不做**：登录与用户体系、推送、AI 摘要、评论/点赞、收藏（二期）、个性化推荐、广告、视频内容、web-view。

| 项 | 值 |
| --- | --- |
| 目标用户 | 仅开发者本人（免登录） |
| 领域 | 在既有的「个人台账」小程序内新增「热点」Tab，不改动工时与账簿功能 |
| 源数量 | 19 个（实测可用，见 `SOURCES.yaml`；D-15 新增杭州人社局、杭州住保房管局） |
| 日入库量 | 150–300 条（去重后） |
| 内容时效 | 当日 07:30 前可用 |
| 分类枚举 | `finance` / `policy` / `world` / `hangzhou` / `general` |
| Tab 映射 | 热点 = 不过滤；财经 = `finance`；政策 = `policy`；国际 = `world`；杭州 = `hangzhou` |

## 1. 常量（唯一来源）

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `TZ` | `Asia/Shanghai` | 所有自然日均按此计算 |
| `TZ_OFFSET_MIN` | `480` | 云函数 UTC 换算用 |
| `FETCH_CRON` | `0 30 6 * * * *` | 云开发 7 段定时 |
| `CLEAN_CRON` | `0 40 6 * * * *` | 数据清理 |
| `FETCH_TIMEOUT_MS` | `8000` | 单源超时 |
| `FETCH_RETRY` | `1` | 单源重试次数 |
| `FETCH_RETRY_DELAY_MS` | `3000` | 重试间隔 |
| `FETCH_BATCH` | `5` | 并发批大小 |
| `FETCH_MAX_MS` | `40000` | 整轮预算 |
| `MAX_ITEMS_PER_SOURCE` | `30` | 每源单次上限 |
| `HTML_REQ_INTERVAL_MS` | `1000` | 页面抓取限速 |
| `REFRESH_COOLDOWN_MIN` | `10` | 手动刷新间隔 |
| `PAGE_SIZE` | `20` | 列表默认页大小 |
| `RETENTION_DAYS` | `90` | 数据保留 |
| `TITLE_MAX` | `200` | 标题字符上限（超出截断） |
| `SUMMARY_MAX` | `120` | 摘要字符上限 |
| `CONTENT_MAX_CHARS` | `5000` | 前端正文展示上限 |
| `CONTENT_MAX_BYTES` | `102400` | 入库正文上限 |
| `CLUSTER_THRESHOLD` | `0.6` | 标题 bigram Jaccard 阈值 |
| `HOT_W_COVER` | `0.55` | 热度权重：覆盖 |
| `HOT_W_FRESH` | `0.30` | 热度权重：新鲜度 |
| `HOT_W_SOURCE` | `0.15` | 热度权重：来源权重 |
| `HOT_TAG_BONUS` | `6` | 惠民标签热度加成（D-14） |
| `TOP_N` | `10` | 热榜条数 |
| `TREND_FETCH_N` | `20` | 热搜抓取条数 |
| `TREND_SHOW_N` | `10` | 热搜展示条数 |
| `MAX_TAGS` | `3` | 单条惠民标签上限 |
| `RELATED_MAX` | `5` | 详情页同事件报道上限 |

## 2. 需求

### R-01 定时抓取编排（P0）

1. 每天 `FETCH_CRON` 触发云函数 `action=fetch, mode=full`。
2. 按 `sources.enabled=true` 取源，按 `FETCH_BATCH` 分批并发；单源 `FETCH_TIMEOUT_MS` 超时、失败重试 `FETCH_RETRY` 次（间隔 `FETCH_RETRY_DELAY_MS`）。
3. 整轮耗时上限 `FETCH_MAX_MS`；未完成的源记 `status=timeout`，不得抛错中断其他源。
4. 全流程顺序：抓取 → 清洗 → 去重 → 聚类 → 热度 → 写 `daily_hot` → 写 `fetch_logs`。
5. 全部源失败时不写入任何 `news`，保留旧数据，`fetch_logs.status=all_failed`。
6. 每源每轮写 1 条 `fetch_logs`（成功/失败都写）。

**验收**
- [ ] 3 个源中 1 个超时，其余 2 个正常入库，`fetch_logs` 有 1 条 fail。
- [ ] 重复触发同一轮 fetch，`news` 不产生重复记录（依赖 `url_hash` 唯一索引）。
- [ ] 全源失败时 `news` 条数不变，且首页仍可读昨日数据。

### R-02 源适配器（P0）

| 适配器 | 输入 | 行为 |
| --- | --- | --- |
| `rss` | `url` | `fast-xml-parser` 解析 RSS/Atom/RDF，取 `title/link/pubDate/description` |
| `json` | `url` | 按源约定字段映射（华尔街见闻：`data.items[].title/content_text/display_time/uri`） |
| `html` | `url` + `linkMatch` | cheerio 取所有链接，保留 href 含 `linkMatch` 且标题 8–80 字的条目；相对链接转绝对 |
| `trend` | `url` | 解析榜单页，取标题与排名，`is_trend=true`，不抓正文 |

1. 每个源最多取 `MAX_ITEMS_PER_SOURCE` 条。
2. `kind=trend` 的源（百度热搜）解析为 `{title,url,rank}`，过滤"查看更多"类条目。
3. 页面源 `linkMatch` 连续 3 天解析 0 条 → `status=structure_changed`，该源暂停并在 `fetch_logs` 标记。
4. HTML 抓取严格串行，间隔 ≥ `HTML_REQ_INTERVAL_MS`。
5. `published_at` 缺失时用 `fetched_at`；明显早于当日（可按链接日期判断）的条目标记 `stale` 供过滤。

**验收**
- [ ] `rss` 源返回空 body 时记 fail，不崩溃。
- [ ] `html` 源 selector 全错时记 `structure_changed`，其他源正常。
- [ ] `json` 源返回非 JSON 时记 fail，不崩溃；`trend` 源页面结构变化时记 `structure_changed`。

### R-03 清洗（P0）

1. HTML 白名单：`p br strong em b i blockquote ul ol li h2 h3 img a`。
2. 移除 `script` / `style` / `iframe` / `on*` 属性 / `class` / `style` / 内联 `javascript:` 链接。
3. `<img src>` 仅保留 `http(s)`，其余删除该标签。
4. `summary` = 去标签 + 压缩连续空白 + 截 `SUMMARY_MAX`。
5. `title` = trim + 压缩空白 + 截 `TITLE_MAX`；空标题丢弃该条。
6. `content_html` 超过 `CONTENT_MAX_BYTES` 截断，保证 UTF-8 边界完整。

**验收**
- [ ] 含 `<script>alert(1)</script>` 的源数据，入库后不含 `alert`。
- [ ] 超长正文入库后字节数 ≤ `CONTENT_MAX_BYTES`，且无乱码（末字符完整）。

### R-04 去重（P0）

1. URL 规范化：小写 scheme/host、去 `utm_*`/`spm`/`from`/`ref` 参数、去 fragment、去末尾 `/`。
2. `url_hash = sha1(normalized_url)`，唯一索引，写入用 upsert。
3. 同日标题完全一致（去空白后）只保留 `source.weight` 最高的一条。
4. `trend` 条目参与 URL 去重，不参与标题去重（榜单标题会重复出现属正常）。

**验收**
- [ ] 同一链接带 `?utm_source=x` 与不带，抓两天后 `news` 只有 1 条。
- [ ] 两源同标题，保留 weight 高的源。

### R-05 事件聚类（P0）

1. 仅对当日、`is_trend=false` 条目聚类。
2. 标题归一化：去标点/空白、全角转半角、去来源前缀。
3. 相似度 = 字符 bigram 集合的 Jaccard 系数；`>= CLUSTER_THRESHOLD` 归为同一 `event_id`。
4. `event_id` = 该簇最早入库条目的 `_id`；`events.news_ids` 存全部成员。
5. 展示标题/摘要取簇内 `weight` 最高来源。
6. 仅在当日数据内聚类，不跨天回溯改写历史。

**验收**
- [ ] 相似度 0.7 的两条合并为 1 个事件；0.4 不合并。
- [ ] 聚类后 `hot_score` 相同的两条不会被拆到两个榜位。

### R-06 热度（P0）

```
C = min(1, ln(1 + source_count) / ln(6))
T = 0.5 ^ (age_hours / 24)
W = mean(source.weight of event members)
hot_score = min(100, round(100 * (0.55*C + 0.30*T + 0.15*W)) + tag_bonus)
tag_bonus = HOT_TAG_BONUS（事件内任一条目带惠民标签时），否则 0
```

1. `age_hours` = `(now - published_at) / 3600`，负数按 0。
2. 每次抓取（定时或手动）后重算当日全部事件。
3. `is_trend=true` 不参与。
4. 结果取整 0–100，存 `events.hot_score` 与 `news.hot_score`。
5. 惠民标签提权：事件成员中任一条目 `tags` 非空即加 `HOT_TAG_BONUS`，加成后再封顶 100（D-14）。

**验收**
- [ ] 5 源、1 小时前、权重 1.0 的事件得分为 99±1。
- [ ] 单源、24 小时前、权重 0.8 的事件得分为 48±1（低于 50）。

### R-07 热榜（P0）

1. 取当日 `hot_score` 降序、`published_at` 降序，前 `TOP_N`。
2. 当日不足 `TOP_N` 条时返回实际条数。
3. 排名变化对比前一自然日 23:59 快照，枚举 `new/up/down/same` 与 `delta`。
4. 无当日数据返回空数组，前端显示空态。

**验收**
- [ ] 首次生成榜单时全部为 `new`。
- [ ] 同分两条按 `published_at` 新者在前。

### R-08 首页列表（P0）

1. 入参 `day`（默认今天）、`category`（默认 null=全部）、`tag`（可选）、`page`（从 1 起）。
2. 过滤 `is_trend=false`、`is_primary=true`、`day` 匹配；`category` 非空时精确匹配。
3. 排序：`category=null` → `hot_score desc, published_at desc`；指定分类 → `published_at desc`。
4. 分页 `PAGE_SIZE`，返回 `total`（**事件数**）、`hasMore`。
5. 响应项字段见 `API.md` `NewsItem`。
6. 事件去重（D-16）：同一 `event_id` 只返回 `is_primary=true` 的代表条目（事件内权重最高的源），避免同一条新闻在列表里重复出现。

**验收**
- [ ] 首页默认只出当天数据，跨天数据不出现。
- [ ] `page=2` 与 `page=1` 无重复条目。
- [ ] 同一事件由 3 家媒体报道时，列表只出现 1 次，卡片显示「3 家媒体报道」。

### R-09 热搜区（P0）

1. 数据来自 `kind=trend` 源，按 `rank` 升序取 `TREND_SHOW_N`。
2. 仅首页「热点」Tab 渲染；无数据时整块隐藏（高度 0，不留白）。
3. 点击词条 → 跳转搜索页并自动搜索该关键词。
4. 搜索无结果时提示"暂无相关报道"，提供「复制关键词」。

**验收**
- [ ] 无 trend 数据时首页首屏不出现空热搜条。
- [ ] 点第 1 条热搜，搜索页关键词框已填入且结果与关键词相关。

### R-10 详情（P0）

1. 返回 `news` 与 `related`（同 `event_id` 的其他成员，按 weight 降序，`RELATED_MAX` 条，排除自身）。
2. 前端正文超过 `CONTENT_MAX_CHARS` 截断并提示；`content_html` 为空时展示 `summary`；政策类（`category=policy`）允许正文为空，展示「该政策未提供正文，点击复制链接查看原文」。
3. 「复制原文链接」调用 `wx.setClipboardData`，成功/失败均有 toast。
4. 政策条目展示 `issuer`、`doc_no`。

**验收**
- [ ] 无 `content_html` 的条目展示摘要，不出现空白页。
- [ ] 复制后剪贴板内容与 `news.url` 完全一致。

### R-11 搜索（P0）

1. 入参 `keyword`（trim 后非空）、`range`（`7d`/`30d`/`all`，默认 `30d`）、`page`。
2. 匹配 `title` 或 `summary` 包含关键词（不区分大小写；中文直接 `includes`）。
3. 时间范围按 `published_at` 过滤；`all` 上限 `RETENTION_DAYS`。
4. 排序 `published_at desc`，分页 `PAGE_SIZE`。
5. 空关键词返回 `E_PARAM`；结果为空返回空数组而非错误。

**验收**
- [ ] 搜"公积金"返回含该词的杭州条目，且不含 90 天前数据。
- [ ] 切 `7d` 与 `all` 结果数量单调不减。

### R-12 归档（P0）

1. `getCalendar` 返回某月有数据的日期与每日**事件数**（统计 `is_primary=true` 的条目，与列表口径一致，D-16）。
2. 选中日期后按 R-08 取当日全部（`category=null`），只读不刷新。
3. 窗口 `RETENTION_DAYS`，更早日期不可选。

**验收**
- [ ] 3 天前日期可正常回看，条目数与该日 `news` 一致。
- [ ] 91 天前日期返回不可选标记。

### R-13 手动刷新（P0）

1. 首页下拉触发 `action=fetch, mode=incr, hours=24`：只处理最近 24h 发布的条目。
2. 服务端限频 `REFRESH_COOLDOWN_MIN`：读最近一次 `fetch_logs.run_at`，未过冷却返回 `E_RATE_LIMIT` 与 `nextAllowedAt`。
3. 返回 `{added, updated, skipped}`；前端 toast "已更新 N 条"/"暂无新内容"。
4. 增量抓取同样执行去重、聚类、热度重算、榜单更新。

**验收**
- [ ] 10 分钟内二次刷新被拦截，提示剩余分钟数。
- [ ] 增量抓取不重复写入已有 `url_hash`。

### R-14 惠民标签（P0）

1. 规则见 `SOURCES.yaml tag_rules`，命中 `title + summary` 即打标。
2. 仅 `category=hangzhou` 打标；最多 `MAX_TAGS` 个，按规则顺序取前 N。
3. 标签值固定 8 类：社保医保 / 公积金 / 住房 / 补贴消费券 / 教育 / 医疗 / 交通出行 / 政务办事。
4. 无命中则为空数组，前端不渲染占位。

**验收**
- [ ] 标题含"公积金"的杭州条目 `tags` 含"公积金"。
- [ ] 标签筛选「教育」只返回命中条目，条数与本地过滤一致。

### R-15 政策元信息（P0）

1. `issuer` 优先取 `sources.issuer`。
2. `doc_no` 从标题正则：`〔\d{4}〕\d+号` 或 `第\d+号`。
3. 仅 `category=policy` 写入；解析失败留空字符串，不阻断入库。
4. **不抓政务详情正文**（D-03）：政策类 `content_html=""`，详情页展示标题 + 机关 + 文号 + 「复制链接」，摘要取列表页标题即可。

**验收**
- [ ] 政策条目卡片显示发文机关。
- [ ] 无文号的政策条目 `doc_no=""`，不报错。

### R-16 分享（P1）

1. `onShareAppMessage` 返回 `{title: news.title, path: /pages/detail/index?id=<id>}`。
2. 无封面时用默认图。
3. 朋友打开直接进详情，只读。

**验收**
- [ ] 分享卡片标题与详情标题一致。
- [ ] 通过分享链接打开，详情正确渲染且无写操作。

### R-17 日志与埋点（P0）

1. `fetch_logs` 每源每轮 1 条：`run_at, source_id, status, item_count, duration_ms, error`。
2. 前端埋点事件枚举：`home_view, card_click, detail_view, copy_link, search_submit, refresh`，写入 `events_log`（或 `wx.reportEvent`）。
3. 埋点失败不得影响主流程（`try/catch` 吞掉）。

**验收**
- [ ] 一轮抓取后 `fetch_logs` 条数 = 源数。
- [ ] 断网时埋点失败不导致页面报错。

### R-18 异常与空态（P0）

| 场景 | 后端返回 | 前端表现 |
| --- | --- | --- |
| 当日无数据 | `items=[]` | "今日数据还没准备好" + 上次更新时间 + 重试 |
| 抓取失败但昨日有数据 | 正常返回昨日 | 顶部黄色提示"数据更新于昨天 HH:mm" |
| 分类无内容 | `items=[]` | "这个分类今天暂时没有内容" + 切换热点 |
| 搜索无结果 | `items=[]` | 引导文案 + 复制关键词 |
| 网络错误 | — | "网络不给力，点我重试" |
| 限频 | `E_RATE_LIMIT` | "刚更新过，X 分钟后再试" |
| 参数错误 | `E_PARAM` | 不弹窗，静默回退默认值 |

**验收**
- [ ] 每个场景在开发者工具中可复现对应文案，无白屏。

## 3. 算法细则

### 3.1 标题归一化（聚类用）

```
1. 去来源前缀：/^(【[^】]{1,10}】|\[[^\]]{1,10}\])\s*/
2. 全角字母数字 → 半角
3. 删除标点与空白：/[\s\p{P}]/gu
4. 转小写
```

### 3.2 热度示例

源数 3、2 小时前、权重均值 0.9：C=0.7737，T=0.9439，W=0.9 → 0.55×0.7737+0.30×0.9439+0.15×0.9 = 0.8437 → **84**。

### 3.3 标签匹配

按 `tag_rules` 声明顺序遍历，命中即加入，达到 `MAX_TAGS` 停止；同一标签只加一次。

## 4. 决策

| ID | 状态 | 结论 / 默认值 |
| --- | --- | --- |
| D-01 | 已确认 | 实测 17/17 可用（D-15 后 19/19）。公共 RSSHub 全部 403 → 不接入微博/知乎热搜，用百度热搜替代；海外源（BBC/FT/NYT/DW）本网络超时 → 剔除，改国内可访问的国际频道 |
| D-02 | 已确认 | 不加「落户」「限行」「天气预警」，维持 8 类标签 |
| D-03 | 已确认 | 不抓政务详情正文，政策类只保留列表页标题/链接/机关/文号 |
| D-04 | 已确认 | 个人主体、不走审核、只发体验版 |
| D-05 | 已确认 | 云开发（云函数 + 云数据库 + 定时触发器） |
| D-06 | 已确认 | 每日 06:30 抓取 |
| D-07 | 已确认 | 分类：热点（全部）/ 财经 / 政策 / 国际 / 杭州 |
| D-08 | 已确认 | 不做推送、不做登录、不做 AI 摘要 |
| D-09 | 已确认 | 正文内嵌 + 复制链接，不用 web-view |
| D-10 | 已确认 | 在 `personal-ledger-miniprogram` 仓库内新增「热点」Tab，保留工时/账簿，不改动既有业务 |
| D-11 | 已确认 | 云函数依赖不增加 YAML 解析库：`docs/SOURCES.yaml` 为唯一事实来源，由 `npm run seed:gen` 生成 `cloudfunctions/news/lib/seed-sources.js` 供 `seedSources` 与抓取使用；`npm test` 校验生成文件与 YAML 一致 |
| D-12 | 已确认 | 修正 R-06 与 §3.2 的算术矛盾：按公式实算，示例为 84（原写 81）、5 源 1 小时为 99（原写 93±2）、单源 24 小时权重 0.8 为 48（原写「低于 40」，该值在公式下不可能低于 48）；公式本身不变 |
| D-13 | 已确认 | R-08「只出当天数据」与 R-18「抓取失败回退昨日」的冲突：`listNews` 默认严格当天；仅当调用方显式传 `fallback=true` 且请求今天、今天无数据时，回退最近 3 天内有数据的一天并在响应中标记 `fallback=true` / `requestedDay`，首页顶部显示「数据更新于昨天 HH:mm」 |
| D-14 | 已确认 | 提高惠民标签权重：事件内任一条目带惠民标签时，`hot_score` 加 `HOT_TAG_BONUS=6`（封顶 100；初版 10，按用户「调低」要求降为 6），让杭州惠民信息在热点列表与热榜中优先露出；公式与常量同步 REQ §1 / R-06 |
| D-15 | 已确认 | 提高惠民标签命中率：① tag_rules 扩充同义词（社保卡/养老金/加装电梯/充电桩/托育/政务服务等）；② 杭州类源加相关性过滤（`relevance_filters`：本地词保留、外地/全国词丢弃、无关键词但命中惠民词保留）；③ 新增杭州市人社局、杭州住保房管局两个官方源（源总数 17 → 19）；④ 标题清洗（去「图片 \|」前缀与尾部日期）与机关名/招聘噪声排除。实测命中率 3.6% → 9.8%（1 → 6 条真惠民） |
| D-16 | 已确认 | 列表按事件去重：聚类阶段为每个 `event_id` 选出唯一代表条目（`is_primary=true`，取权重最高的源，同权重取最早入库），`listNews` 与 `getCalendar` 只统计代表条目，`total`/分页/归档计数改为事件维度；详情页同事件报道与搜索不受影响 |
| D-17 | 已确认 | 部署排障三项：① 查询类 action 惰性加载 `pipeline`（`cheerio` 需 Node 18+），使 Node 16 运行时下 `ping`/查询仍可用；② 新增 `bootstrap` 一次性建集合 + 导入种子，未配置 `ADMIN_TOKEN` 时仅允许空库首次执行；③ 客户端区分「云函数未部署(-501000)/执行失败(-504002/-504003)/真断网」，不再统一显示成「网络不给力」 |
| D-18 | 已确认 | 云函数运行时仍是 Nodejs16.13（控制台只读、无法改），因此改为在代码层兼容：`cheerio` 固定 `1.0.0-rc.12`、`fetch` 用 `node-fetch@2` 兜底；同时把入库/事件/日志写入改为并发 5–10（云数据库单条写延迟高，串行会顶满 60s 超时），`bootstrap` 允许在「种子未导全」时续跑，客户端空列表不写缓存（避免数据未就绪时把空结果缓存 30 分钟） |



