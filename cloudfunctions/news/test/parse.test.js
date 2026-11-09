// cloudfunctions/news/test/parse.test.js
// T-04 验收：四种适配器解析、清洗、去重、stale 判定、每源条数上限。
const test = require('node:test');
const assert = require('node:assert');

const {
  parseSource,
  parseRss,
  parseJson,
  parseHtml,
  parseTrend,
  cleanText,
  truncate,
  guessDateFromUrl,
  toMs
} = require('../lib/parse');
const { C } = require('../lib/const');

const NOW = Date.parse('2026-11-08T12:00:00+08:00');

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[央行上调外汇存款准备金率 2 个百分点]]></title>
    <link>https://www.chinanews.com.cn/cj/2026/11-08/123.shtml</link>
    <pubDate>Sat, 08 Nov 2026 09:00:00 +0800</pubDate>
    <description><![CDATA[<p>央行宣布&amp;quot;上调&amp;quot;准备金率</p><script>alert(1)</script>]]></description>
  </item>
  <item>
    <title>   </title>
    <link>https://example.com/empty</link>
  </item>
  <item>
    <title>杭州文博会开幕 吸引市民参观</title>
    <link>/hz/2026/11-08/456.shtml</link>
  </item>
</channel></rss>`;

const WSCN = JSON.stringify({
  data: {
    items: [
      { id: 1, title: '英伟达超 7600 万元货物离奇失踪', content_text: '快讯正文', display_time: 1794132000, uri: 'https://wallstreetcn.com/livenews/1' },
      { id: 2, content_text: '无标题快讯应被丢弃', display_time: 1794132000, uri: 'https://wallstreetcn.com/livenews/2' }
    ]
  }
});

const HTML = `<html><body>
  <a href="/detail/2527806">财政部等三部门实施居民购房贷款贴息</a>
  <a href="/detail/2527807">短标题</a>
  <a href="javascript:void(0)">javascript 链接应该被忽略</a>
  <a href="https://example.com/other/1">不匹配 linkMatch 的链接标题</a>
  <a href="/detail/2527806">财政部等三部门实施居民购房贷款贴息</a>
</body></html>`;

const TREND = `<html><body>
  <a href="https://www.baidu.com/s?wd=%E8%83%96%E4%B8%9C%E6%9D%A5">胖东来回应洗发水产地造假 热</a>
  <a href="https://www.baidu.com/s?wd=abc">多地延迟到校取消早读 新</a>
  <a href="https://www.baidu.com/s?wd=more">查看更多</a>
  <a href="https://www.baidu.com/s?wd=abc">多地延迟到校取消早读 新</a>
</body></html>`;

test('cleanText 去标签/实体/脚本并压缩空白', () => {
  assert.strictEqual(cleanText('<p>a &amp; b</p><script>alert(1)</script>'), 'a & b');
  assert.strictEqual(cleanText('  多   空白\n\n 文本 '), '多 空白 文本');
  assert.strictEqual(cleanText('&#39;引号&#39;'), "'引号'");
});

test('truncate 按字符截断且不破坏代理对', () => {
  assert.strictEqual(truncate('abcdef', 3), 'abc');
  assert.strictEqual(truncate('😀😀😀', 2), '😀😀');
  assert.strictEqual(Array.from(truncate('😀😀😀', 2)).length, 2);
});

test('guessDateFromUrl 识别常见日期片段', () => {
  assert.strictEqual(guessDateFromUrl('https://x.com/2026-11-07/a.html'), Date.parse('2026-11-07T00:00:00+08:00'));
  assert.strictEqual(guessDateFromUrl('https://x.com/news/20261107/a.html'), Date.parse('2026-11-07T00:00:00+08:00'));
  assert.strictEqual(guessDateFromUrl('https://x.com/a.html'), null);
});

test('toMs 支持 10 位秒与日期字符串', () => {
  assert.strictEqual(toMs(1794132000), 1794132000000);
  assert.strictEqual(toMs(1794132000000), 1794132000000);
  assert.strictEqual(toMs('Sat, 08 Nov 2026 09:00:00 +0800'), Date.parse('2026-11-08T09:00:00+08:00'));
  assert.strictEqual(toMs(''), null);
});

test('rss：解析标题/链接/时间/摘要，丢弃空标题，相对链接转绝对', () => {
  const items = parseRss(RSS, { id: 'x', url: 'https://www.chinanews.com.cn/rss/world.xml', adapter: 'rss', kind: 'news' }, NOW);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].title, '央行上调外汇存款准备金率 2 个百分点');
  assert.ok(items[0].url.startsWith('https://www.chinanews.com.cn/cj/'));
  assert.strictEqual(items[0].publishedAt, Date.parse('2026-11-08T09:00:00+08:00'));
  assert.ok(items[0].summary.includes('上调'));
  assert.ok(!items[0].summary.includes('alert'), 'R-03：script 内容不得进入摘要');
  assert.strictEqual(items[1].url, 'https://www.chinanews.com.cn/hz/2026/11-08/456.shtml');
});

test('json：按华尔街见闻字段映射，无标题条目丢弃', () => {
  const items = parseJson(WSCN, { id: 'w', url: 'https://api.example.com', adapter: 'json', kind: 'news' }, NOW);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, '英伟达超 7600 万元货物离奇失踪');
  assert.strictEqual(items[0].publishedAt, 1794132000000);
  assert.strictEqual(items[0].summary, '快讯正文');
});

test('json：非 JSON 抛错，由上层记 fail 而不崩溃', () => {
  assert.throws(() => parseJson('<html>not json</html>', { id: 'w', url: 'https://x', adapter: 'json' }, NOW), /invalid json/);
});

test('html：linkMatch 过滤、去重、忽略 javascript 与短标题、相对链接转绝对', () => {
  const src = { id: 'cls', url: 'https://www.cls.cn/', adapter: 'html', kind: 'news', linkMatch: '/detail/' };
  const items = parseHtml(HTML, src, NOW);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].url, 'https://www.cls.cn/detail/2527806');
});

test('html：selector 完全不匹配时返回空数组（上层记 structure_changed）', () => {
  const src = { id: 'x', url: 'https://x.com/', adapter: 'html', kind: 'news', linkMatch: '/nope/' };
  assert.deepStrictEqual(parseHtml(HTML, src, NOW), []);
});

test('trend：按出现顺序给 rank，过滤「查看更多」，同名去重', () => {
  const src = { id: 'baidu_hot', url: 'https://top.baidu.com/board?tab=realtime', adapter: 'trend', kind: 'trend' };
  const items = parseTrend(TREND, src, NOW);
  assert.strictEqual(items.length, 2);
  assert.deepStrictEqual(items.map((i) => i.rank), [1, 2]);
  assert.strictEqual(items[0].title, '胖东来回应洗发水产地造假');
  assert.strictEqual(items[0].isTrend, true);
  assert.strictEqual(items[0].stale, false);
});

test('stale：早于今日的条目标记为 stale（trend 不参与）', () => {
  const rss = `<rss><channel><item><title>昨天的旧稿标题在这里</title><link>https://x.com/2026-11-07/a.html</link></item></channel></rss>`;
  const items = parseRss(rss, { id: 'x', url: 'https://x.com/', adapter: 'rss', kind: 'news' }, NOW);
  assert.strictEqual(items[0].publishedAt, Date.parse('2026-11-07T00:00:00+08:00'));
  assert.strictEqual(items[0].stale, true);
});

test('parseSource：每源上限 MAX_ITEMS_PER_SOURCE，并按 url 去重', () => {
  const many = Array.from({ length: 50 }, (_, i) => `<a href="/detail/${i}">这是第 ${i} 条足够长的测试标题</a>`).join('');
  const src = { id: 'x', url: 'https://x.com/', adapter: 'html', kind: 'news', linkMatch: '/detail/' };
  const res = parseSource(src, `<html><body>${many}</body></html>`, { now: NOW });
  assert.strictEqual(res.adapter, 'html');
  assert.strictEqual(res.items.length, C.MAX_ITEMS_PER_SOURCE);
});

test('parseSource：未知 adapter 回退 html', () => {
  const src = { id: 'x', url: 'https://x.com/', adapter: 'weird', kind: 'news', linkMatch: '/detail/' };
  const res = parseSource(src, HTML, { now: NOW });
  assert.strictEqual(res.items.length, 1);
});
