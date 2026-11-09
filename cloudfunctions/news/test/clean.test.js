// cloudfunctions/news/test/clean.test.js
// T-05 验收：R-03 清洗、R-15 政策元信息。
const test = require('node:test');
const assert = require('node:assert');

const { sanitizeHtml, buildNewsItem, extractDocNo, normalizeTitleText, stripSourcePrefix } = require('../lib/clean');
const { C } = require('../lib/const');

const NOW = Date.parse('2026-11-08T12:00:00+08:00');

const SOURCE = {
  id: 'chinanews',
  name: '中国新闻网',
  category: 'general',
  kind: 'news',
  weight: 0.9
};

function makeRaw(over) {
  return Object.assign(
    {
      title: '杭州文博会开幕 吸引市民参观',
      url: 'https://www.chinanews.com.cn/sh/2026/11-08/1.shtml',
      publishedAt: NOW - 3600000,
      summary: '摘要',
      contentHtml: ''
    },
    over
  );
}

test('R-03 清洗：删除 script/style/iframe 与事件属性，保留白名单标签', () => {
  const dirty =
    '<div class="x" style="color:red"><script>alert(1)</script>' +
    '<p onclick="evil()">正文<strong>加粗</strong></p>' +
    '<iframe src="https://evil"></iframe><ul><li>条目</li></ul></div>';
  const clean = sanitizeHtml(dirty);
  assert.ok(!clean.includes('alert'), '脚本内容必须移除');
  assert.ok(!clean.includes('onclick'), '事件属性必须移除');
  assert.ok(!clean.includes('class='), 'class 必须移除');
  assert.ok(!clean.includes('style='), 'style 必须移除');
  assert.ok(!clean.includes('<iframe'), 'iframe 必须移除');
  assert.ok(clean.includes('<strong>加粗</strong>'));
  assert.ok(clean.includes('<li>条目</li>'));
});

test('R-03.2：javascript: 链接去掉 href，a 文本保留', () => {
  const clean = sanitizeHtml('<a href="javascript:alert(1)">点我</a>');
  assert.ok(!clean.includes('javascript:'));
  assert.ok(clean.includes('点我'));
});

test('R-03.3：img 仅保留 http(s)，其余整条删除', () => {
  const clean = sanitizeHtml('<p><img src="data:image/png;base64,xx"><img src="https://a.com/1.png" alt="图"></p>');
  assert.ok(!clean.includes('data:image'), 'data URI 图片应删除');
  assert.ok(clean.includes('https://a.com/1.png'));
  assert.ok(clean.includes('alt="图"'));
});

test('R-03.4/5：summary 截断到 SUMMARY_MAX，标题截断到 TITLE_MAX', () => {
  const doc = buildNewsItem(
    makeRaw({ title: '标'.repeat(300), summary: '摘'.repeat(300) }),
    SOURCE,
    { now: NOW }
  );
  assert.strictEqual(Array.from(doc.title).length, C.TITLE_MAX);
  assert.strictEqual(Array.from(doc.summary).length, C.SUMMARY_MAX);
});

test('R-03.6：content_html 超过 CONTENT_MAX_BYTES 时按字节截断且无乱码', () => {
  const huge = '<p>' + '汉'.repeat(60000) + '</p>'; // 180KB+ UTF-8
  const doc = buildNewsItem(makeRaw({ contentHtml: huge }), SOURCE, { now: NOW });
  const bytes = Buffer.byteLength(doc.content_html, 'utf8');
  assert.ok(bytes <= C.CONTENT_MAX_BYTES, `实际 ${bytes} 字节`);
  assert.strictEqual(Buffer.from(doc.content_html, 'utf8').toString('utf8'), doc.content_html);
  // 最后一个字符不得是替换符
  assert.ok(!doc.content_html.includes('\uFFFD'));
});

test('空标题条目返回 null（R-03.5）', () => {
  assert.strictEqual(buildNewsItem(makeRaw({ title: '   ' }), SOURCE, { now: NOW }), null);
});

test('NewsItem 字段齐全（API §2.1）', () => {
  const doc = buildNewsItem(makeRaw({}), SOURCE, { now: NOW });
  for (const f of [
    'title', 'url', 'source_id', 'source_name', 'category', 'published_at', 'fetched_at',
    'day', 'summary', 'content_html', 'cover', 'event_id', 'hot_score', 'is_trend',
    'tags', 'issuer', 'doc_no'
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(doc, f), '缺少字段 ' + f);
  }
  assert.strictEqual(doc.day, '2026-11-08');
  assert.deepStrictEqual(doc.tags, []);
  assert.strictEqual(doc.hot_score, 0);
  assert.strictEqual(doc.is_trend, false);
  assert.ok(doc.published_at instanceof Date);
});

test('R-15：政策条目无正文、带发文机关与文号', () => {
  const src = { id: 'gov_cn', name: '中国政府网', category: 'policy', kind: 'news', weight: 1, issuer: '国务院' };
  const doc = buildNewsItem(
    makeRaw({
      title: '国务院办公厅关于2027年部分节假日安排的通知（国办发〔2026〕12号）',
      contentHtml: '<p>政策正文</p>'
    }),
    src,
    { now: NOW }
  );
  assert.strictEqual(doc.content_html, '', 'D-03：政策不抓正文');
  assert.strictEqual(doc.issuer, '国务院');
  assert.strictEqual(doc.doc_no, '〔2026〕12号');
});

test('R-15.2：文号缺失时为空串，不报错', () => {
  const src = { id: 'gov_cn', name: '中国政府网', category: 'policy', kind: 'news', weight: 1, issuer: '国务院' };
  const doc = buildNewsItem(makeRaw({ title: '关于做好当前经济工作的通知' }), src, { now: NOW });
  assert.strictEqual(doc.doc_no, '');
});

test('D-15：标题清洗去掉列表页形态前缀与尾部日期', () => {
  assert.strictEqual(normalizeTitleText('图片 | 杭州市2026年社保服务进万家活动'), '杭州市2026年社保服务进万家活动');
  assert.strictEqual(normalizeTitleText('动态 | 市人社局召开专题会议 2026-11-03'), '市人社局召开专题会议');
  assert.strictEqual(normalizeTitleText('杭州文博会开幕'), '杭州文博会开幕');

  const doc = buildNewsItem(
    makeRaw({ title: '图片 | 杭州市2026年社保服务进万家活动 2026-11-03' }),
    SOURCE,
    { now: NOW }
  );
  assert.strictEqual(doc.title, '杭州市2026年社保服务进万家活动');
});

test('源级前缀清洗：澎湃「推荐」前缀被去掉，短标题不误伤', () => {
  const src = Object.assign({}, SOURCE, { titleStrip: ['推荐'] });
  const doc = buildNewsItem(makeRaw({ title: '推荐山西太原一建筑发生火灾致5人遇难' }), src, { now: NOW });
  assert.strictEqual(doc.title, '山西太原一建筑发生火灾致5人遇难');
  // 剩余过短时不动，避免把「推荐系统」类正常词切掉
  assert.strictEqual(stripSourcePrefix('推荐系统', ['推荐']), '推荐系统');
  assert.strictEqual(normalizeTitleText('图片 | 杭州市2026年社保服务进万家活动'), '杭州市2026年社保服务进万家活动');
});

test('标题清洗去掉站点拼接的时间与「N 评」', () => {
  assert.strictEqual(
    normalizeTitleText('金价波动加大，多家银行上线积存金“挂单”功能11-09 19:400评'),
    '金价波动加大，多家银行上线积存金“挂单”功能'
  );
  assert.strictEqual(normalizeTitleText('某条新闻 2026-11-09 19:40 12评'), '某条新闻');
  // 正常标题不误伤
  assert.strictEqual(normalizeTitleText('11-09 起杭州地铁延长运营'), '11-09 起杭州地铁延长运营');
});

test('extractDocNo 支持两种形态', () => {
  assert.strictEqual(extractDocNo('关于印发《办法》的通知（财税〔2025〕3号）'), '〔2025〕3号');
  assert.strictEqual(extractDocNo('中国人民银行公告第7号'), '第7号');
  assert.strictEqual(extractDocNo('无关标题'), '');
});

test('trend 条目 is_trend=true 且摘要可为空', () => {
  const src = { id: 'baidu_hot', name: '百度热搜', category: 'general', kind: 'trend', weight: 0.8 };
  const doc = buildNewsItem(
    { title: '胖东来回应洗发水产地造假', url: 'https://www.baidu.com/s?wd=x', isTrend: true, rank: 1 },
    src,
    { now: NOW }
  );
  assert.strictEqual(doc.is_trend, true);
  assert.strictEqual(doc.rank, 1);
  assert.strictEqual(doc.summary, '');
});
