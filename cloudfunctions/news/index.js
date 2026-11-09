// cloudfunctions/news/index.js
// 唯一云函数入口：action 路由。契约见 docs/API.md §3，任务拆解见 docs/TASKS.md。
const { ERR, C } = require('./lib/const');
const { ok, fail } = require('./lib/respond');
const { getDB } = require('./lib/db');
const seed = require('./lib/seed');
const query = require('./lib/query');

// 惰性加载：pipeline 依赖 cheerio，而 cheerio 需要 Node 18+。
// 这样即使云函数运行时仍是 Node 16，查询类 action 与 ping 也能正常工作。
let pipelineModule = null;
function getPipeline() {
  if (!pipelineModule) pipelineModule = require('./lib/pipeline');
  return pipelineModule;
}

function msOf(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

const COLLECTIONS = ['news', 'events', 'sources', 'daily_hot', 'fetch_logs', 'config', 'events_log'];

/**
 * 构建 action 处理器表。deps 允许注入 { db, adminToken }，便于本地单测。
 * 后续任务（T-04 起）在此追加 listNews / getTrends / getNews / search / getHot /
 * getCalendar / refresh / fetch。
 */
function buildHandlers(deps) {
  const d = deps || {};
  const db = () => d.db || getDB();
  const pl = () => d.pipeline || getPipeline();

  // 参数错误抛 E_PARAM，其余异常交给路由归一为 E_INTERNAL
  async function guarded(fn) {
    try {
      return ok(await fn());
    } catch (err) {
      if (err && err.code === ERR.PARAM) return fail(ERR.PARAM, err.message);
      if (err && err.code === ERR.NOT_FOUND) return fail(ERR.NOT_FOUND, err.message);
      throw err;
    }
  }

  return {
    // 健康检查：DoD 要求 action=ping 返回 {ok:true}
    ping() {
      return ok({ pong: true, now: Date.now() });
    },

    // T-03：导入 SOURCES.yaml 种子（sources 17 条 + config/tag_rules 8 条），仅维护时调用
    async seedSources(event) {
      const expected = d.adminToken || process.env.ADMIN_TOKEN;
      if (!expected || event.adminToken !== expected) {
        return fail(ERR.FORBIDDEN);
      }
      const data = await seed.seedSources(db());
      return ok(data);
    },

    // D-17：一次性初始化（建 7 个集合 + 导入种子）。
    // 配了 ADMIN_TOKEN 时需带 token；未配置时仅允许「空库首次执行」，避免重复调用。
    async bootstrap(event) {
      const database = db();
      const expected = d.adminToken || process.env.ADMIN_TOKEN;
      if (expected) {
        if (event.adminToken !== expected) return fail(ERR.FORBIDDEN);
      } else {
        let hasAll = false;
        try {
          const probe = await database.collection('sources').count();
          const total = (probe && probe.total) || 0;
          // 只在「已导入全部种子」时视为已初始化；部分导入（例如上次被 3s 超时打断）允许补齐
          hasAll = total >= seed.SEED.sources.length;
        } catch (err) {
          hasAll = false;
        }
        if (hasAll) return fail(ERR.FORBIDDEN, 'already initialized');
      }

      const created = [];
      for (const name of COLLECTIONS) {
        try {
          await database.createCollection(name);
          created.push(name);
        } catch (err) {
          /* 集合已存在 */
        }
      }

      const seeded = await seed.seedSources(database);
      return ok({ created: created, seeded: seeded });
    },

    // T-06：定时抓取（R-01）。仅接受定时触发器或带 ADMIN_TOKEN 的内部调用。
    async fetch(event) {
      const isTimer = event.Type === 'Timer';
      const expected = d.adminToken || process.env.ADMIN_TOKEN;
      if (!isTimer && (!expected || event.adminToken !== expected)) {
        return fail(ERR.FORBIDDEN);
      }
      const data = await pl().runFetch(db(), {
        mode: event.mode === 'incr' ? 'incr' : 'full',
        hours: event.hours
      });
      return ok(data);
    },

    // T-06：手动刷新（R-13），10 分钟限频
    async refresh() {
      const database = db();
      const now = Date.now();
      const cooldownMs = C.REFRESH_COOLDOWN_MIN * 60000;
      const lockRes = await database.collection('config').where({ _id: 'refresh_lock' }).limit(1).get();
      const lock = (lockRes.data && lockRes.data[0]) || null;
      const lastRunAt = lock ? msOf(lock.last_run_at) : 0;
      const nextAllowedAt = lastRunAt ? lastRunAt + cooldownMs : now;

      if (lastRunAt && now - lastRunAt < cooldownMs) {
        const res = fail(ERR.RATE_LIMIT, 'refresh too frequent');
        res.error.nextAllowedAt = nextAllowedAt;
        return res;
      }

      const data = await pl().runFetch(database, { mode: 'incr', hours: 24 });
      data.nextAllowedAt = now + cooldownMs;

      const patch = { last_run_at: new Date(now) };
      if (lock) await database.collection('config').doc(lock._id).update({ data: patch });
      else await database.collection('config').add({ data: Object.assign({ _id: 'refresh_lock' }, patch) });

      return ok(data);
    },

    // T-06：90 天清理（CLEAN_CRON 触发）
    async cleanup(event) {
      const isTimer = event.Type === 'Timer';
      const expected = d.adminToken || process.env.ADMIN_TOKEN;
      if (!isTimer && (!expected || event.adminToken !== expected)) {
        return fail(ERR.FORBIDDEN);
      }
      const removed = await pl().cleanup(db());
      return ok({ removed: removed });
    },

    // T-08：首页列表（R-08）
    listNews(event) {
      return guarded(() => query.listNews(db(), event));
    },

    // T-08：热搜（R-09）
    getTrends(event) {
      return guarded(() => query.getTrends(db(), event));
    },

    // T-09：热榜 Top10 与排名变化（R-07）
    getHot(event) {
      return guarded(() => query.getHot(db(), event));
    },

    // T-10：搜索（R-11）
    search(event) {
      return guarded(() => query.searchNews(db(), event));
    },

    // T-11：详情 + 同事件报道（R-10）
    getNews(event) {
      return guarded(() => query.getNews(db(), event));
    },

    // T-12：归档月历（R-12）
    getCalendar(event) {
      return guarded(() => query.getCalendar(db(), event));
    },

    // T-13：埋点写入 events_log（R-17）
    track(event) {
      return guarded(() => query.trackEvent(db(), event));
    }
  };
}

/**
 * 纯路由：默认依赖在首次调用时解析，因此可直接在 node:test 中传入 deps 测试。
 * @param {object} event 云函数入参，必须含 string 类型的 action
 * @param {object} [deps] { db, adminToken }
 */
async function route(event, deps) {
  const evt = event || {};
  const action = evt.action;

  if (typeof action !== 'string' || action === '') {
    return fail(ERR.PARAM, 'action is required');
  }

  const handlers = buildHandlers(deps);
  const handler = handlers[action];
  if (!handler) {
    return fail(ERR.PARAM, 'unknown action: ' + action);
  }

  try {
    return await handler(evt);
  } catch (err) {
    // 未知异常只记日志，不把原始堆栈返回给前端（API §3.3-6）
    console.error('[news] action ' + action + ' failed:', err && err.message);
    return fail(ERR.INTERNAL);
  }
}

exports.route = route;
exports.buildHandlers = buildHandlers;

/**
 * 定时触发器不带 action，按 TriggerName 映射到具体动作（见 config.json）。
 * fetchDaily → fetch；cleanupDaily → cleanup。
 */
function normalizeEvent(event) {
  const evt = Object.assign({}, event || {});
  if (evt.Type === 'Timer' && !evt.action) {
    evt.action = evt.TriggerName === 'cleanupDaily' ? 'cleanup' : 'fetch';
  }
  return evt;
}

exports.normalizeEvent = normalizeEvent;

// 云端入口：不传 deps，由 lib/db 懒加载 wx-server-sdk
exports.main = async (event) => route(normalizeEvent(event));

