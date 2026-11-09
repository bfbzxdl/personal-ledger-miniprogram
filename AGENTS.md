# AGENTS.md — 项目上下文（AI 开发唯一入口）

动手前必须读完本文件与 `docs/` 下 4 个文档。本文件同时定义**文档规范**，后续所有文档、设计、注释都按此执行。

## 1. 项目

微信小程序「每日热点」：个人自用。每日 06:30 抓取 19 个已实测可用的公开新闻源，去重聚类后生成热点列表、热搜榜、热榜 Top10，支持分类筛选、搜索、90 天归档、杭州惠民标签。代码托管在既有「个人台账」仓库内，新增「热点」Tab，不改动工时/账簿业务。

## 2. 技术栈（不得替换）

| 项 | 选择 |
| --- | --- |
| 端 | 微信小程序原生框架（禁止 Taro / uni-app） |
| 后端 | 微信云开发：云函数（Node 18）+ 云数据库 + 定时触发器 |
| 云函数依赖 | `wx-server-sdk`、`fast-xml-parser`、`cheerio` |
| 基础设施 | 无自建服务器、无域名、无 web-view、无登录 |

## 3. 目录结构（基于既有台账仓库，增量开发）

```
personal-ledger-miniprogram/
├── AGENTS.md
├── docs/{REQ.md, API.md, SOURCES.yaml, TASKS.md}
├── scripts/                      # 抓取实测脚本（node scripts/fetch-digest.mjs）
├── app.{js,json,wxss}            # 既有；新增第 4 个 Tab「热点」
├── pages/{home,work,ledger,admin}/   # 既有，不改
├── pages/news/{home,detail,archive}/ # 新增
├── components/                   # 既有 + news-card / trend-strip / state-view
├── custom-tab-bar/               # 4 个 Tab：首页 / 工时 / 账簿 / 热点
├── cloudfunctions/{admin,daily-content}/  # 既有，不改
├── cloudfunctions/news/
│   ├── index.js                  # action 路由
│   ├── lib/{const,fetch,parse,clean,dedupe,cluster,hot,tags}.js
│   ├── package.json
│   └── test/                     # 纯函数单测
└── miniprogram_npm/
```

## 4. 硬约束（违反即回退）

1. 个人主体：禁用 `web-view`；不做登录；不提交审核，只发体验版。
2. 小程序端只读数据库；所有写入只能发生在云函数内。
3. 时区固定 Asia/Shanghai；`day` 一律 `YYYY-MM-DD`。
4. 定时任务每天 06:30 一次；手动刷新 10 分钟限频。
5. 抓取：单源超时 8s、重试 1 次、每批 5 个并发、整轮 ≤40s。
6. 数据保留 90 天，每天 06:40 清理。
7. 不抓登录后内容、不绕付费墙、不整篇转载媒体正文；页面抓取限速 1 req/s。
8. 阈值、分页、时间等常量只允许出现在 `docs/REQ.md §1`，代码里用常量引用，禁止散落魔法数。

## 5. 文档规范（长期有效）

- **结构化优先**：配置、字段、状态用表格 / YAML / JSON 表达，不用段落叙述。
- **可追溯**：需求 `R-xx`、任务 `T-xx`、决策 `D-xx`、错误码 `E_xxx`；提交说明必须引用 ID。
- **可执行**：每条规则给出常量、字段名、函数签名或伪代码；禁止"尽量""适当""合理"这类词。
- **可验证**：每条需求带验收断言（Given/When/Then 或断言列表），断言必须可自动或手工判定。
- **自足**：新文档必须能被单独读懂，不依赖对话上下文。
- **同步**：改字段 → 同步 `docs/API.md`；改常量 → 同步 `docs/REQ.md §1`；改需求 → 先改文档再改代码。
- **按日期归档**：每次开发生成的项目文档（需求、设计、决策、变更记录、当日快照）统一放入 `docs/YYYY-MM-DD/` 新文件夹；现行版本仍保留在 `docs/` 与根目录 `AGENTS.md`，日期目录只做追溯，不参与构建。

## 6. 完成定义（DoD）

- 对应 `R-xx` 的验收断言逐条自查通过，结果写进提交说明。
- `node --check` 通过；小程序端在开发者工具中无报错、无告警。
- 新增/修改字段与常量已同步文档。
- 无硬编码密钥；环境变量走云开发配置。

## 7. 文档索引

| 文件 | 作用 |
| --- | --- |
| `docs/REQ.md` | 需求、常量、算法、验收断言（实现依据） |
| `docs/API.md` | 集合 schema、云函数契约、页面路由、错误码 |
| `docs/SOURCES.yaml` | 19 个已实测源、8 类标签规则、杭州相关性过滤（seed 数据） |
| `docs/TASKS.md` | 任务拆解、依赖、产出文件、DoD、执行顺序 |

## 8. 当前状态

- 阶段：`T-01~T-13` 全部完成；云函数 `news` 已部署到 `cloud1-d7g8ut4pf7af59d27`（超时已调 60s，运行时仍 Nodejs16.13，已按 D-18 做兼容），数据库已初始化并跑通一轮抓取：340 个事件、热榜 10 条、热搜 10 条，开发者工具内可看到真实数据；`D-14` 惠民标签提权（`HOT_TAG_BONUS=6`）、`D-15` 命中率提升（19 源 + 词表扩充 + 相关性过滤）、`D-16` 列表按事件去重均已实施；已在微信开发者工具（`C:\Program Files (x86)\Tencent\微信web开发者工具`）实机验证 4 个页面；下一步 `T-14` 体验版发布与 3 天数据观察（需云环境）。
- 本地预览：`node scripts/preview-pages.mjs` 生成 `out/preview/*.html`（真实 WXSS + 真实数据）；`node scripts/devtools-shot.cjs <home|hot|detail|archive>` 通过 miniprogram-automator 在开发者工具内注入数据并截图到 `out/devtools/`（需先 `cli auto --project <path> --auto-port 9420`）。
- 今日文档目录：`docs/2026-11-09/`（按日期归档规则，见 §5）。
- 种子数据流：`docs/SOURCES.yaml` →（`npm run seed:gen`）→ `cloudfunctions/news/lib/seed-sources.js`；改源后必须重跑生成，`npm test` 会校验两者一致。
- 已定决策：`D-01`~`D-18` 全部确认，见 `docs/REQ.md §4`，不再阻塞。





