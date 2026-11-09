# TASKS — 执行顺序与完成标准

> 一个任务一次提交；提交说明格式：`T-xx: 一句话`，正文附对应 `R-xx` 验收结果。
> 基线：M0 已完成（17 个源实测通过，见 `out/digest-2026-11-08.md`）；D-15 新增 2 个杭州源，现为 19 源。

## 总览

| ID | 任务 | 依赖 | 产出 | 估时 |
| --- | --- | --- | --- | --- |
| T-01 | 集成骨架 | — | `app.json` 注册 news 页、custom-tab-bar 加第 4 项、`pages/news/home` 空壳 | 0.5 |
| T-02 | 云函数骨架 | T-01 | `cloudfunctions/news/index.js`、`lib/const.js`、响应封装 | 0.5 |
| T-03 | 集合与种子 | T-02 | 建集合/索引、`seedSources`（导入全部源） | 0.5 |
| T-04 | 抓取适配器 | T-03 | `lib/fetch.js`、`parse.js`（rss/json/html/trend），对齐实测配置 | 1 |
| T-05 | 清洗/去重/聚类/热度/标签 | T-04 | `lib/{clean,dedupe,cluster,hot,tags}.js` + 单测 | 2 |
| T-06 | 抓取编排 | T-05 | `lib/pipeline.js`、定时器、`fetch_logs`、90 天清理 | 1.5 |
| T-07 | 请求层与卡片 | T-06 | `utils/news-api.js`、`cache.js`、`components/news-card` | 0.5 |
| T-08 | 热点页·今日 | T-07 | 分类 Tab、热搜区、列表、下拉刷新、骨架屏 | 1.5 |
| T-09 | 热点页·热榜 | T-08 | Top10 + 排名变化（同一页分段） | 0.5 |
| T-10 | 热点页·搜索 | T-08 | 关键词 + 时间范围 + 历史 + 热搜联动 | 0.75 |
| T-11 | 详情页 | T-08 | 正文渲染、同事件报道、复制/分享 | 0.75 |
| T-12 | 归档页 | T-08 | 月历、当日列表 | 0.75 |
| T-13 | 状态与埋点 | T-09..T-12 | 空态/错误态/限频提示/埋点 | 0.75 |
| T-14 | 体验版 | T-13 | 发布 + 连续 3 天数据观察与调参 | 持续 |

合计约 11.5 人日（不含观察）。

## 验收门禁（每个任务都必须满足）

1. `node --check` 通过所有改动文件。
2. 纯函数任务（T-05）附 `node:test` 单测，覆盖 REQ 对应验收断言。
3. 涉及接口的任务，用本地脚本或云开发控制台实测返回结构符合 `API.md`。
4. 修改字段/常量必须同批更新 `API.md` / `REQ.md §1`。
5. 不修改 `pages/home`、`pages/work`、`pages/ledger`、`cloudfunctions/admin`、`cloudfunctions/daily-content`。

## 任务明细

### T-01 集成骨架
产出：`app.json` 增加 `pages/news/home/index`、`pages/news/detail/index`、`pages/news/archive/index`；`custom-tab-bar` 增加「热点」（第 4 项；图标沿用既有 emoji 方案 🔥，不新增 `assets/` 二进制资源）；3 个页面空壳。
DoD：开发者工具中 4 个 Tab 均可切换；原有 3 个 Tab 功能无变化。

### T-02 云函数骨架
产出：`news/index.js` action 路由、`lib/const.js`（REQ §1 常量）、`lib/respond.js`。
DoD：`action=ping` 返回 `{ok:true}`；未知 action 返回 `E_PARAM`；`node --check` 通过。

### T-03 集合与种子
产出：`scripts/init-collections.js`（7 集合 + 索引）、`action=seedSources`（读 `SOURCES.yaml` 写 `sources` 与 `config/tag_rules`）。
DoD：`sources` 17 条且 `verified=true`；`config` 8 条标签规则；重复执行不产生重复。

### T-04 抓取适配器
产出：`fetch.js`（超时/重试/分批/页面串行限速）、`parse.js`（rss/json/html/trend 四种，按 `SOURCES.yaml` 的 `linkMatch` 与字段映射）、`time.js`（自然日与时区换算）、`scripts/probe-lib.mjs`（实测脚本）。
DoD：`node scripts/probe-lib.mjs` 全部源取到 ≥5 条；单源超时不阻塞；适配器输出含 `title/url/publishedAt/summary/rank/hotValue/isTrend/stale`（NewsItem 所需的全部原始字段，完整 `NewsItem` 由 T-05 组装）。

### T-05 清洗/去重/聚类/热度/标签
产出：`clean.js`、`dedupe.js`、`cluster.js`、`hot.js`、`tags.js`、`text.js` + `test/*.test.js`。
DoD：单测覆盖 R-03/04/05/06/14 全部断言；热度示例与 REQ §3.2 一致（84±1）。

### T-06 抓取编排
产出：`pipeline.js`（抓取编排 + 入库 + 热榜快照 + 日志 + 清理）、`index.js` 的 `fetch/refresh/cleanup` 动作、`cloudfunctions/news/config.json`（06:30 抓取 / 06:40 清理两个定时触发器）。
DoD：手动触发一次跑通；`fetch_logs` 条数 = 17；`daily_hot` 生成 10 条（数据足够时）；失败源不阻塞；90 天清理可执行。

### T-07 请求层与卡片
产出：`utils/news-api.js`（callFunction 封装 + 错误码映射 + 列表/热搜 5/30 分钟缓存）、`utils/cache.js`、`utils/date.js`、`components/news-card`。
DoD：错误码统一映射；卡片在有图/无图/无摘要三种数据下高度正常（`min-height` + 固定封面尺寸，开发者工具目视确认）。

### T-08 热点页·今日
产出：`pages/news/home`（分段容器、5 个分类 Tab、热搜区 `components/trend-strip`、列表、分页、下拉刷新、骨架屏、杭州标签筛选）、`lib/query.js` 的 `listNews`/`getTrends`、`config/news.js`。
DoD：R-08、R-09、R-13 验收通过；骨架屏与空态正确。

### T-09 热点页·热榜
产出：热点页「热榜」分段（懒加载、涨跌标签、空态/错误态）、`lib/query.js` 的 `getHot`。
DoD：R-07 验收通过；空态文案正确。

### T-10 热点页·搜索
产出：热点页「搜索」分段（输入框、7d/30d/all 时间范围、搜索历史、分页、无结果复制关键词）、`lib/query.js` 的 `searchNews`。
DoD：R-11 验收通过；热搜词带入并自动搜索。

### T-11 详情页
产出：`pages/news/detail`（正文 rich-text、政策机关/文号、正文超长截断提示、复制链接、同事件报道、分享）、`lib/query.js` 的 `getNews`。
DoD：R-10 验收通过；政策条目无正文时的提示正确；复制 toast。

### T-12 归档页
产出：`pages/news/archive`（月历、每日条数、90 天窗口内可选、当日只读列表）、`lib/query.js` 的 `getCalendar`。
DoD：R-12 验收通过；无数据日期不可选（提示后仍可查看空态）。

### T-13 状态与埋点
产出：`components/state-view`（统一空态/错误态，已用于首页/详情/归档）、首页「数据更新于昨天」兜底提示、`lib/query.js` 的 `trackEvent` 与 `events_log` 写入。
DoD：R-17、R-18 验收通过；断网不白屏。

### T-14 体验版
产出：体验版二维码、抓取日志周报。
DoD：连续 3 天 07:30 前有数据；按日志调整权重与停用源，结论写回 `REQ.md D-xx`。



