// test/client/news-archive.test.js
// T-12：归档页（月历、可选性、当日列表、只读）。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'pages', 'news', 'archive', 'index.js');
const API_PATH = require.resolve('../../utils/news-api');

const toasts = [];
const navigations = [];

global.wx = {
  showToast: (opt) => toasts.push(opt),
  navigateTo: (opt) => navigations.push(opt),
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {}
};

const apiMock = {
  calendar: async () => apiMock.calendarResult(),
  getCalendar: async () => apiMock.calendarResult(),
  calendarResult: () => ({
    ok: true,
    data: { month: '2026-11', days: ['2026-11-06', '2026-11-08'], counts: { '2026-11-06': 3, '2026-11-08': 12 }, minDay: '2026-08-10', maxDay: '2026-11-08' }
  }),
  listCalls: [],
  listNews: async (params) => {
    apiMock.listCalls.push(params);
    return apiMock.listResult();
  },
  listResult: () => ({ ok: true, data: { items: [{ id: 'a1', title: '归档条目', publishedAt: Date.now(), tags: [], sourceName: '源', summary: '', sourceCount: 1, hotScore: 50 }], total: 1, hasMore: false } })
};
require.cache[API_PATH] = { id: API_PATH, filename: API_PATH, loaded: true, exports: apiMock };
delete require.cache[PAGE_PATH];

let definition = null;
global.Page = (def) => {
  definition = def;
};
require(PAGE_PATH);

function makeCtx() {
  const ctx = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  for (const key of Object.keys(definition)) {
    if (typeof definition[key] === 'function') ctx[key] = definition[key].bind(ctx);
  }
  return ctx;
}

async function load(options) {
  const ctx = makeCtx();
  ctx.onLoad(options || {});
  await new Promise((r) => setTimeout(r, 10));
  return ctx;
}

test('onLoad 加载月历：标题、格子数、有数据日期与条数', async () => {
  const ctx = await load({ date: '2026-11-08' });
  assert.strictEqual(ctx.data.month, '2026-11');
  assert.ok(ctx.data.monthText.includes('2026'));
  assert.ok(ctx.data.monthText.includes('11'));
  assert.strictEqual(ctx.data.loading, false);

  const cells = ctx.data.cells.filter((c) => !c.empty);
  assert.strictEqual(cells.length, 30, '11 月 30 天');
  const padCount = new Date(2026, 10, 1).getDay();
  assert.strictEqual(ctx.data.cells.length, padCount + 30, '首行按星期补位');
  if (padCount > 0) assert.ok(ctx.data.cells[0].key.startsWith('pad-'));

  const d6 = cells.find((c) => c.day === '2026-11-06');
  const d7 = cells.find((c) => c.day === '2026-11-07');
  assert.strictEqual(d6.count, 3);
  assert.strictEqual(d6.hasData, true);
  assert.strictEqual(d7.hasData, false);
});

test('选中日期默认加载当日列表，且只请求一次', async () => {
  apiMock.listCalls.length = 0;
  const ctx = await load({ date: '2026-11-06' });
  assert.strictEqual(apiMock.listCalls[0].day, '2026-11-06');
  assert.strictEqual(ctx.data.items.length, 1);
  assert.strictEqual(ctx.data.listTotal, 1, '列表头用服务端 total，而不是当前页条数');
  assert.ok(ctx.data.selectedText.includes('11'));
});

test('点击有数据日期切换选中并重新加载列表', async () => {
  apiMock.listCalls.length = 0;
  const ctx = await load({ date: '2026-11-08' });
  ctx.onDayTap({ currentTarget: { dataset: { day: '2026-11-06' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.selectedDay, '2026-11-06');
  assert.strictEqual(apiMock.listCalls[apiMock.listCalls.length - 1].day, '2026-11-06');
  const selected = ctx.data.cells.filter((c) => c.isSelected);
  assert.strictEqual(selected.length, 1);
});

test('超出 90 天窗口的日期不可选（R-12.3）', async () => {
  apiMock.calendarResult = () => ({
    ok: true,
    data: { month: '2026-11', days: [], counts: {}, minDay: '2026-11-05', maxDay: '2026-11-08' }
  });
  const ctx = await load({ date: '2026-11-08' });
  const d1 = ctx.data.cells.find((c) => c.day === '2026-11-01');
  assert.strictEqual(d1.disabled, true);

  toasts.length = 0;
  apiMock.listCalls.length = 0;
  ctx.onDayTap({ currentTarget: { dataset: { day: '2026-11-01' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(toasts[0].title, '该日期超出可回看范围');
  assert.strictEqual(apiMock.listCalls.length, 0);
  apiMock.calendarResult = () => ({
    ok: true,
    data: { month: '2026-11', days: ['2026-11-06'], counts: { '2026-11-06': 3 }, minDay: '2026-08-10', maxDay: '2026-11-08' }
  });
});

test('点击无数据日期给出提示，但仍可查看（空态）', async () => {
  const ctx = await load({ date: '2026-11-08' });
  toasts.length = 0;
  apiMock.listResult = () => ({ ok: true, data: { items: [], total: 0, hasMore: false } });
  ctx.onDayTap({ currentTarget: { dataset: { day: '2026-11-07' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(toasts[0].title, '这一天没有记录');
  assert.deepStrictEqual(ctx.data.items, []);
  apiMock.listResult = () => ({ ok: true, data: { items: [{ id: 'a1', title: '归档条目', publishedAt: Date.now(), tags: [], sourceName: '源', summary: '', sourceCount: 1, hotScore: 50 }], total: 1, hasMore: false } });
});

test('上一月/下一月受窗口限制', async () => {
  const ctx = await load({ date: '2026-11-08' });
  assert.strictEqual(ctx.data.canNext, false, '已是窗口最后一个月');
  const before = ctx.data.month;
  ctx.onNextMonth();
  assert.strictEqual(ctx.data.month, before, '不能进入未来月份');

  assert.strictEqual(ctx.data.canPrev, true);
  ctx.onPrevMonth();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.month, '2026-10');
});

test('卡片点击进入详情', async () => {
  navigations.length = 0;
  const ctx = await load({ date: '2026-11-08' });
  ctx.onCardTap({ detail: { id: 'a1' } });
  assert.strictEqual(navigations[0].url, '/pages/news/detail/index?id=a1');
});

test('月历加载失败展示错误态并可重试', async () => {
  apiMock.calendarResult = () => ({ ok: false, error: { code: 'E_NETWORK', message: '网络不给力，点我重试' } });
  const ctx = await load({ date: '2026-11-08' });
  assert.strictEqual(ctx.data.error, '网络不给力，点我重试');
  assert.strictEqual(ctx.data.loading, false);
  apiMock.calendarResult = () => ({
    ok: true,
    data: { month: '2026-11', days: ['2026-11-06'], counts: { '2026-11-06': 3 }, minDay: '2026-08-10', maxDay: '2026-11-08' }
  });
});
