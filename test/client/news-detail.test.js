// test/client/news-detail.test.js
// T-11：详情页逻辑（R-10 正文/政策/复制、R-16 分享）。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'pages', 'news', 'detail', 'index.js');
const API_PATH = require.resolve('../../utils/news-api');

const toasts = [];
const redirects = [];
const clipboard = [];
const tracks = [];

global.wx = {
  showToast: (opt) => toasts.push(opt),
  setClipboardData: (opt) => {
    clipboard.push(opt.data);
    if (opt.success) opt.success();
  },
  redirectTo: (opt) => redirects.push(opt),
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {}
};

const apiMock = {
  track: (name, payload) => tracks.push({ name, payload }),
  result: { ok: true, data: { news: null, related: [] } },
  getNews: async () => apiMock.result
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

function news(over) {
  return Object.assign(
    {
      id: 'n1',
      title: '央行上调外汇存款准备金率',
      sourceName: '中国新闻网',
      category: 'finance',
      publishedAt: Date.now() - 3600000,
      summary: '摘要文本',
      contentHtml: '<p>正文</p>',
      url: 'https://example.com/n1',
      tags: [],
      sourceCount: 2
    },
    over
  );
}

test('onLoad 加载详情并写入展示字段', async () => {
  tracks.length = 0;
  apiMock.result = { ok: true, data: { news: news(), related: [{ id: 'n2', title: '同事件报道' }] } };
  const ctx = makeCtx();
  ctx.onLoad({ id: 'n1' });
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(ctx.data.loading, false);
  assert.strictEqual(ctx.data.error, '');
  assert.strictEqual(ctx.data.news.id, 'n1');
  assert.strictEqual(ctx.data.contentHtml, '<p>正文</p>');
  assert.strictEqual(ctx.data.isPolicy, false);
  assert.strictEqual(ctx.data.related.length, 1);
  assert.ok(ctx.data.timeText.includes(':'));
  assert.ok(tracks.some((t) => t.name === 'detail_view'));
});

test('超长正文按 5000 字截断并给出提示', async () => {
  apiMock.result = { ok: true, data: { news: news({ contentHtml: '字'.repeat(6000) }), related: [] } };
  const ctx = makeCtx();
  ctx.onLoad({ id: 'n1' });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.contentHtml.length, 5000);
  assert.strictEqual(ctx.data.truncated, true);
});

test('政策详情标记 isPolicy（正文为空展示提示）', async () => {
  apiMock.result = {
    ok: true,
    data: { news: news({ category: 'policy', contentHtml: '', issuer: '国务院', docNo: '〔2026〕12号', summary: '政策摘要' }), related: [] }
  };
  const ctx = makeCtx();
  ctx.onLoad({ id: 'n1' });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.isPolicy, true);
  assert.strictEqual(ctx.data.contentHtml, '');
  assert.strictEqual(ctx.data.news.docNo, '〔2026〕12号');
});

test('E_NOT_FOUND 展示「内容已失效」，其他错误展示原始文案并可重试', async () => {
  apiMock.result = { ok: false, error: { code: 'E_NOT_FOUND', message: '内容已失效' } };
  const ctx = makeCtx();
  ctx.onLoad({ id: 'gone' });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.error, '内容已失效');
  assert.strictEqual(ctx.data.loading, false);

  apiMock.result = { ok: false, error: { code: 'E_NETWORK', message: '网络不给力，点我重试' } };
  const ctx2 = makeCtx();
  ctx2.onLoad({ id: 'x' });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx2.data.error, '网络不给力，点我重试');
});

test('缺少 id 直接给出失效提示，不请求', async () => {
  const ctx = makeCtx();
  let called = 0;
  const original = apiMock.getNews;
  apiMock.getNews = async () => {
    called += 1;
    return { ok: true, data: {} };
  };
  ctx.onLoad({});
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(called, 0);
  assert.strictEqual(ctx.data.error, '内容已失效');
  apiMock.getNews = original;
});

test('复制原文链接：内容与 url 一致并 toast（R-10.3/验收）', async () => {
  clipboard.length = 0;
  toasts.length = 0;
  tracks.length = 0;
  const ctx = makeCtx();
  ctx.data.news = news();
  ctx.data.id = 'n1';
  ctx.onCopyLink();
  assert.deepStrictEqual(clipboard, ['https://example.com/n1']);
  assert.strictEqual(toasts[0].title, '已复制链接');
  assert.ok(tracks.some((t) => t.name === 'copy_link'));

  global.wx.setClipboardData = (opt) => {
    if (opt.fail) opt.fail();
  };
  toasts.length = 0;
  ctx.onCopyLink();
  assert.strictEqual(toasts[0].title, '复制失败');
});

test('分享标题与详情标题一致，路径带 id（R-16）', () => {
  const ctx = makeCtx();
  ctx.data.news = news();
  ctx.data.id = 'n1';
  const share = ctx.onShareAppMessage();
  assert.strictEqual(share.title, '央行上调外汇存款准备金率');
  assert.strictEqual(share.path, '/pages/news/detail/index?id=n1');
});

test('同事件报道点击用 redirectTo 替换当前页', () => {
  redirects.length = 0;
  const ctx = makeCtx();
  ctx.data.id = 'n1';
  ctx.onRelatedTap({ detail: { id: 'n2' } });
  assert.strictEqual(redirects[0].url, '/pages/news/detail/index?id=n2');

  redirects.length = 0;
  ctx.onRelatedTap({ detail: { id: 'n1' } });
  assert.strictEqual(redirects.length, 0, '点击自身不跳转');
});
