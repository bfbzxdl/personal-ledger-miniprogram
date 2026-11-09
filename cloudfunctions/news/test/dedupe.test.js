// cloudfunctions/news/test/dedupe.test.js
// T-05 验收：R-04 去重。
const test = require('node:test');
const assert = require('node:assert');

const { normalizeUrl, urlHash, dedupeItems } = require('../lib/dedupe');

function item(over) {
  return Object.assign(
    {
      title: '默认标题内容',
      url: 'https://example.com/a',
      day: '2026-11-08',
      source_id: 's1',
      source_weight: 0.8,
      is_trend: false
    },
    over
  );
}

test('R-04.1：URL 规范化——小写 scheme/host、去跟踪参数、去 fragment、去末尾 /', () => {
  assert.strictEqual(
    normalizeUrl('HTTPS://Example.COM/path/?utm_source=x&spm=1&from=app&id=7#frag'),
    'https://example.com/path?id=7'
  );
  assert.strictEqual(normalizeUrl('https://example.com/a/'), 'https://example.com/a');
  assert.strictEqual(normalizeUrl('https://example.com:443/a'), 'https://example.com/a');
  assert.strictEqual(normalizeUrl(' http://example.com/a/ '), 'http://example.com/a');
});

test('R-04.1：保留业务参数（如 id、tab）', () => {
  assert.strictEqual(normalizeUrl('https://x.com/a?id=1&tab=2'), 'https://x.com/a?id=1&tab=2');
});

test('R-04.2：url_hash = sha1(规范化 url)，同一链接两种写法哈希一致', () => {
  assert.strictEqual(urlHash('https://example.com/a?utm_source=x'), urlHash('https://example.com/a'));
  assert.strictEqual(urlHash('https://example.com/a').length, 40);
});

test('R-04 验收：同链接带 utm 与不带，去重后只剩 1 条', () => {
  const out = dedupeItems([
    item({ url: 'https://example.com/a', source_weight: 0.8 }),
    item({ url: 'https://example.com/a?utm_source=x', source_weight: 0.9, title: '另一个标题' })
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].source_weight, 0.9, '保留权重更高的源');
  assert.strictEqual(out[0].url_hash.length, 40);
});

test('R-04 验收：两源同标题，保留 weight 高的源', () => {
  const out = dedupeItems([
    item({ title: '央行上调外汇存款准备金率', source_id: 'low', source_weight: 0.5, url: 'https://a.com/1' }),
    item({ title: '央行上调外汇存款准备金率', source_id: 'high', source_weight: 1, url: 'https://b.com/2' })
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].source_id, 'high');
});

test('R-04.3：标题去空白后比较（"A B" 与 "AB" 视为一致）', () => {
  const out = dedupeItems([
    item({ title: '杭州 文博会 开幕', url: 'https://a.com/1' }),
    item({ title: '杭州文博会开幕', url: 'https://b.com/2', source_weight: 0.9 })
  ]);
  assert.strictEqual(out.length, 1);
});

test('R-04.4：trend 条目参与 URL 去重，但不参与标题去重', () => {
  const out = dedupeItems([
    item({ title: '同一个词条', url: 'https://www.baidu.com/s?wd=a', is_trend: true }),
    item({ title: '同一个词条', url: 'https://www.baidu.com/s?wd=b', is_trend: true }),
    item({ title: '同一个词条', url: 'https://news.com/x', is_trend: false })
  ]);
  assert.strictEqual(out.length, 3, 'trend 同标题不同链接都保留，新闻条目单独保留');
});

test('跨天同标题不去重（R-04.3 仅同日）', () => {
  const out = dedupeItems([
    item({ title: '每日固定栏目', day: '2026-11-07', url: 'https://a.com/1' }),
    item({ title: '每日固定栏目', day: '2026-11-08', url: 'https://b.com/2' })
  ]);
  assert.strictEqual(out.length, 2);
});

test('无 url 的条目被丢弃', () => {
  const out = dedupeItems([item({ url: '' })]);
  assert.strictEqual(out.length, 0);
});
