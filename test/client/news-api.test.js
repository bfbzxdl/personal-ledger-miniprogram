// test/client/news-api.test.js
// T-07：请求层错误码映射与缓存行为（docs/API.md §5）。
const test = require('node:test');
const assert = require('node:assert');

const store = new Map();
let calls = 0;
let nextResult = { result: { ok: true, data: { items: [] } } };
let nextError = null;

global.wx = {
  getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k, v) => store.set(k, v),
  removeStorageSync: (k) => store.delete(k),
  getStorageInfoSync: () => ({ keys: Array.from(store.keys()) }),
  cloud: {
    callFunction: async (payload) => {
      calls += 1;
      if (nextError) throw nextError;
      return nextResult;
    }
  }
};

const api = require('../../utils/news-api');

function reset() {
  store.clear();
  calls = 0;
  nextError = null;
  nextResult = { result: { ok: true, data: { items: [] } } };
}

test('成功调用透传 data', async () => {
  reset();
  nextResult = { result: { ok: true, data: { items: [{ id: '1' }], total: 1 } } };
  const res = await api.call('listNews', { category: 'finance' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data.total, 1);
  assert.strictEqual(calls, 1);
});

test('业务错误码映射为中文提示', async () => {
  reset();
  nextResult = { result: { ok: false, error: { code: 'E_RATE_LIMIT', message: 'raw', nextAllowedAt: 123 } } };
  const res = await api.call('refresh');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error.code, 'E_RATE_LIMIT');
  assert.strictEqual(res.error.message, '刚更新过，请稍后再试');
  assert.strictEqual(res.error.nextAllowedAt, 123);
});

test('未知错误码归一为 E_INTERNAL，且保留原始信息', async () => {
  reset();
  nextResult = { result: { ok: false, error: { code: 'E_WHATEVER', message: 'boom' } } };
  const res = await api.call('x');
  assert.strictEqual(res.error.code, 'E_INTERNAL');
  assert.strictEqual(res.error.raw, 'boom');
});

test('网络异常返回 E_NETWORK 而不是抛出', async () => {
  reset();
  nextError = new Error('request:fail');
  const res = await api.call('listNews');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error.code, 'E_NETWORK');
  assert.strictEqual(res.error.message, '网络不给力，点我重试');
});

test('listNews 命中缓存后不再请求云函数', async () => {
  reset();
  nextResult = { result: { ok: true, data: { items: [1], total: 1 } } };
  const first = await api.listNews({ category: 'policy', page: 1 });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(calls, 1);

  const second = await api.listNews({ category: 'policy', page: 1 });
  assert.strictEqual(calls, 1, '第二次应命中缓存');
  assert.strictEqual(second.fromCache, true);

  const bypass = await api.listNews({ category: 'policy', page: 1 }, { noCache: true });
  assert.strictEqual(calls, 2, 'noCache 必须重新请求');
  assert.ok(!bypass.fromCache);
});

test('不同分类/分页使用不同缓存键', async () => {
  reset();
  await api.listNews({ category: 'policy', page: 1 });
  await api.listNews({ category: 'finance', page: 1 });
  await api.listNews({ category: 'policy', page: 2 });
  assert.strictEqual(calls, 3);
});

test('失败结果不写缓存', async () => {
  reset();
  nextResult = { result: { ok: false, error: { code: 'E_INTERNAL', message: 'x' } } };
  await api.listNews({ page: 1 });
  assert.strictEqual(store.size, 0);
});

test('refresh 成功后清空列表缓存', async () => {
  reset();
  nextResult = { result: { ok: true, data: { added: 5, nextAllowedAt: 999 } } };
  store.set('news:list:today:all:all:1', { t: Date.now(), v: {} });
  const res = await api.refresh();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(store.size, 0);
});

test('云函数未部署时给出可操作提示，而不是「网络不给力」', async () => {
  reset();
  nextError = Object.assign(new Error('fail'), {
    errCode: -501000,
    errMsg: 'cloud.callFunction:fail Error: errCode: -501000 ... FUNCTION_NOT_FOUND'
  });
  const res = await api.call('listNews');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error.code, 'E_SERVICE');
  assert.ok(res.error.message.includes('云函数 news 未部署'), res.error.message);
});

test('云函数执行崩溃时提示查看控制台日志', async () => {
  reset();
  nextError = Object.assign(new Error('fail'), {
    errCode: -504002,
    errMsg: 'cloud.callFunction:fail Error: errCode: -504002 functions execute fail | 145 code exit unexpected'
  });
  const res = await api.call('ping');
  assert.strictEqual(res.error.code, 'E_SERVICE');
  assert.ok(res.error.message.includes('执行失败'), res.error.message);
});

test('真断网仍归类为 E_NETWORK 并保留原始信息', async () => {
  reset();
  nextError = Object.assign(new Error('fail'), { errMsg: 'cloud.callFunction:fail request:fail timeout' });
  const res = await api.call('listNews');
  assert.strictEqual(res.error.code, 'E_NETWORK');
  assert.strictEqual(res.error.message, '网络不给力，点我重试');
  assert.ok(res.error.raw.includes('timeout'));
});

test('空列表不写缓存（数据未就绪时不能被缓存 5/30 分钟）', async () => {
  reset();
  nextResult = { result: { ok: true, data: { items: [], total: 0 } } };
  await api.getTrends({ day: '2026-11-09' });
  assert.strictEqual(store.size, 0, '空结果不应写缓存');

  nextResult = { result: { ok: true, data: { items: [{ rank: 1, title: '热搜' }], total: 1 } } };
  const second = await api.getTrends({ day: '2026-11-09' });
  assert.ok(!second.fromCache, '第二次应真正请求');
  assert.strictEqual(store.size, 1, '有数据后才缓存');
});

test('track 失败被吞掉，不影响调用方', () => {
  reset();
  nextError = new Error('no cloud');
  assert.doesNotThrow(() => api.track('home_view', { page: 'home' }));
});

test('错误码表覆盖 API §5 全部枚举', () => {
  for (const code of ['E_PARAM', 'E_NOT_FOUND', 'E_RATE_LIMIT', 'E_SOURCE', 'E_INTERNAL', 'E_FORBIDDEN']) {
    assert.ok(api.ERROR_MESSAGES[code], '缺少 ' + code);
  }
});
