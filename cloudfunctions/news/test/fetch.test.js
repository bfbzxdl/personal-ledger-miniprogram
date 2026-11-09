// cloudfunctions/news/test/fetch.test.js
// T-04 验收：页面抓取严格串行且间隔 ≥ HTML_REQ_INTERVAL_MS；字符集解码。
const test = require('node:test');
const assert = require('node:assert');

const { decode, withHtmlLock, __resetThrottle } = require('../lib/fetch');
const { C } = require('../lib/const');

test('withHtmlLock：并发调用被串行化，相邻开始间隔 ≥ HTML_REQ_INTERVAL_MS', async () => {
  __resetThrottle();
  const starts = [];
  const task = () => {
    starts.push(Date.now());
    return Promise.resolve('done');
  };

  const results = await Promise.all([withHtmlLock(task), withHtmlLock(task), withHtmlLock(task)]);

  assert.deepStrictEqual(results, ['done', 'done', 'done']);
  assert.strictEqual(starts.length, 3);
  const gap1 = starts[1] - starts[0];
  const gap2 = starts[2] - starts[1];
  assert.ok(gap1 >= C.HTML_REQ_INTERVAL_MS - 50, `第 2 次间隔 ${gap1}ms`);
  assert.ok(gap2 >= C.HTML_REQ_INTERVAL_MS - 50, `第 3 次间隔 ${gap2}ms`);
  __resetThrottle();
});

test('withHtmlLock：任务抛错不影响后续任务', async () => {
  __resetThrottle();
  const bad = withHtmlLock(() => Promise.reject(new Error('boom')));
  await assert.rejects(bad, /boom/);
  const okRes = await withHtmlLock(() => Promise.resolve('after'));
  assert.strictEqual(okRes, 'after');
});

test('decode：按 content-type 声明的 charset 解码', () => {
  // GBK 编码的「中文」
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  assert.strictEqual(decode(gbk, 'text/html; charset=gbk'), '中文');
  const utf8 = Buffer.from('中文', 'utf8');
  assert.strictEqual(decode(utf8, 'application/json; charset=utf-8'), '中文');
  assert.strictEqual(decode(utf8, ''), '中文');
});

test('decode：页面 meta 声明 charset 时按 meta 解码', () => {
  const head = Buffer.concat([
    Buffer.from('<html><head><meta charset="gbk"></head><body>'),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    Buffer.from('</body></html>')
  ]);
  assert.ok(decode(head, 'text/html').includes('中文'));
});
