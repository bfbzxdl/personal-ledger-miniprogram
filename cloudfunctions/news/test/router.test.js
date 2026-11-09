// cloudfunctions/news/test/router.test.js
// T-02 验收：action=ping 返回 {ok:true}；未知 action 返回 E_PARAM；异常不外泄。
const test = require('node:test');
const assert = require('node:assert');

const { route } = require('../index');
const { C, ERR } = require('../lib/const');
const { ok, fail } = require('../lib/respond');

test('ping 返回 ok:true', async () => {
  const res = await route({ action: 'ping' }, {});
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data.pong, true);
  assert.strictEqual(typeof res.data.now, 'number');
});

test('缺少 action 返回 E_PARAM', async () => {
  const res = await route({}, {});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error.code, ERR.PARAM);
});

test('未知 action 返回 E_PARAM', async () => {
  const res = await route({ action: 'nope' }, {});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error.code, ERR.PARAM);
});

test('处理器抛错返回 E_INTERNAL 且不带堆栈', async () => {
  const originalError = console.error;
  console.error = () => {}; // 该路径会记日志，测试时静默
  const brokenDb = {
    collection() {
      throw new Error('secret stack');
    }
  };
  try {
    const res = await route({ action: 'seedSources', adminToken: 'k' }, { db: brokenDb, adminToken: 'k' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, ERR.INTERNAL);
    assert.ok(!res.error.message.includes('secret stack'));
  } finally {
    console.error = originalError;
  }
});

test('响应封装符合 API 契约', () => {
  assert.deepStrictEqual(ok({ a: 1 }), { ok: true, data: { a: 1 } });
  assert.deepStrictEqual(ok(), { ok: true, data: {} });
  const f = fail(ERR.PARAM, 'keyword is required');
  assert.deepStrictEqual(f, { ok: false, error: { code: 'E_PARAM', message: 'keyword is required' } });
  // 未知错误码归一为 E_INTERNAL
  assert.strictEqual(fail('E_WHATEVER', 'x').error.code, ERR.INTERNAL);
});

test('热度权重之和为 1', () => {
  const sum = C.HOT_W_COVER + C.HOT_W_FRESH + C.HOT_W_SOURCE;
  assert.ok(Math.abs(sum - 1) < 1e-9, '权重和应为 1，实际 ' + sum);
});
