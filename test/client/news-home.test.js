// test/client/news-home.test.js
// T-08：热点页（今日分段）逻辑：加载、分页、分类、标签、空态/错误态、下拉刷新限频、热搜跳转。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'pages', 'news', 'home', 'index.js');
const API_PATH = require.resolve('../../utils/news-api');

const toasts = [];
const navigations = [];

global.wx = {
  showToast: (opt) => toasts.push(opt),
  stopPullDownRefresh: () => {},
  navigateTo: (opt) => navigations.push(opt),
  showNavigationBarLoading: () => {},
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getStorageInfoSync: () => ({ keys: [] })
};

// 用桩替换请求层，避免真实 wx.cloud
const apiMock = {
  track: () => {},
  calls: [],
  listNews: async (params) => apiMock.calls.push(params) && { ok: true, data: apiMock.listResult() },
  getTrends: async () => ({ ok: true, data: { items: apiMock.trends } }),
  getHot: async () => apiMock.hotResult(),
  hotResult: () => ({ ok: true, data: { items: apiMock.hot } }),
  hot: [],
  searchCalls: [],
  search: async (params) => {
    apiMock.searchCalls.push(params);
    return apiMock.searchResult();
  },
  searchResult: () => ({ ok: true, data: { items: apiMock.searchItems, total: apiMock.searchItems.length, hasMore: false, page: 1, keyword: 'x', range: '30d' } }),
  searchItems: [],
  refresh: async () => apiMock.refreshResult(),
  listResult: () => ({ items: [], total: 0, hasMore: false, day: '2026-11-08', updatedAt: 0, page: 1 }),
  trends: [],
  refreshResult: () => ({ ok: true, data: { added: 2, nextAllowedAt: Date.now() + 600000 } })
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
    },
    getTabBar() {
      return { setData: () => {} };
    }
  };
  for (const key of Object.keys(definition)) {
    if (typeof definition[key] === 'function') ctx[key] = definition[key].bind(ctx);
  }
  return ctx;
}

function item(id, title) {
  return { id: id, title: title, sourceName: '测试源', publishedAt: Date.now() - 60000, summary: '', tags: [], hotScore: 50, sourceCount: 1 };
}

test('onLoad 加载列表并关闭骨架屏', async () => {
  apiMock.calls.length = 0;
  apiMock.listResult = () => ({ items: [item('a', '标题 A'), item('b', '标题 B')], total: 2, hasMore: false, day: '2026-11-08', updatedAt: Date.now(), page: 1 });
  apiMock.trends = [{ rank: 1, title: '热搜词' }];

  const ctx = makeCtx();
  ctx.onLoad();
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(ctx.data.items.length, 2);
  assert.strictEqual(ctx.data.skeleton, false);
  assert.strictEqual(ctx.data.total, 2);
  assert.strictEqual(ctx.data.trends.length, 1);
  assert.ok(ctx.data.dayText.includes('月'));
  assert.ok(ctx.data.updatedText.startsWith('更新于'));
  assert.strictEqual(apiMock.calls[0].page, 1);
});

test('空列表给出默认空态文案', async () => {
  apiMock.calls.length = 0;
  apiMock.listResult = () => ({ items: [], total: 0, hasMore: false, day: '2026-11-08', updatedAt: 0, page: 1 });
  apiMock.trends = [];
  const ctx = makeCtx();
  ctx.onLoad();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.emptyText, '今日数据还没准备好');
  assert.strictEqual(ctx.data.skeleton, false);
});

test('分类切换重置列表并按分类请求；分类空态文案不同', async () => {
  apiMock.calls.length = 0;
  apiMock.listResult = () => ({ items: [], total: 0, hasMore: false, day: '2026-11-08', updatedAt: 0, page: 1 });
  const ctx = makeCtx();
  ctx.onLoad();
  await new Promise((r) => setTimeout(r, 10));
  apiMock.calls.length = 0;

  ctx.onCategoryTap({ currentTarget: { dataset: { key: 'hangzhou' } } });
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(ctx.data.category, 'hangzhou');
  assert.strictEqual(ctx.data.page, 1);
  assert.strictEqual(apiMock.calls[0].category, 'hangzhou');
  assert.strictEqual(ctx.data.emptyText, '这个分类今天暂时没有内容');
});

test('杭州分类下标签筛选带入 tag 参数，再次点击取消', async () => {
  apiMock.calls.length = 0;
  const ctx = makeCtx();
  ctx.data.category = 'hangzhou';
  ctx.onTagTap({ currentTarget: { dataset: { tag: '公积金' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.tag, '公积金');
  assert.strictEqual(apiMock.calls[apiMock.calls.length - 1].tag, '公积金');

  ctx.onTagTap({ currentTarget: { dataset: { tag: '公积金' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.tag, '');
});

test('请求失败展示错误态与重试按钮', async () => {
  apiMock.listResult = () => ({ items: [], total: 0, hasMore: false });
  const original = apiMock.listNews;
  apiMock.listNews = async () => ({ ok: false, error: { code: 'E_NETWORK', message: '网络不给力，点我重试' } });
  const ctx = makeCtx();
  ctx.onLoad();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.error, '网络不给力，点我重试');
  assert.strictEqual(ctx.data.skeleton, false);
  apiMock.listNews = original;
});

test('上拉加载追加下一页，到底后不再请求', async () => {
  apiMock.calls.length = 0;
  apiMock.listResult = () => ({ items: [item('c', '标题 C')], total: 3, hasMore: true, day: '2026-11-08', updatedAt: 0, page: 2 });
  const ctx = makeCtx();
  ctx.data.items = [item('a', 'A'), item('b', 'B')];
  ctx.data.page = 1;
  ctx.data.hasMore = true;

  ctx.onReachBottom();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.items.length, 3);
  assert.strictEqual(apiMock.calls[0].page, 2);

  ctx.data.hasMore = false;
  apiMock.calls.length = 0;
  ctx.onReachBottom();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(apiMock.calls.length, 0);
});

test('下拉刷新限频：提示剩余分钟数', async () => {
  toasts.length = 0;
  apiMock.refreshResult = () => ({
    ok: false,
    error: { code: 'E_RATE_LIMIT', message: '刚更新过，请稍后再试', nextAllowedAt: Date.now() + 5 * 60000 }
  });
  const ctx = makeCtx();
  await ctx.onRefresh();
  assert.ok(toasts.length > 0);
  assert.ok(toasts[0].title.includes('分钟后再试'), toasts[0].title);

  apiMock.refreshResult = () => ({ ok: true, data: { added: 2, nextAllowedAt: Date.now() + 600000 } });
  toasts.length = 0;
  await ctx.onRefresh();
  assert.ok(toasts[0].title.includes('已更新 2 条'), toasts[0].title);
});

test('热搜点击切到搜索分段并自动搜索', async () => {
  apiMock.searchCalls.length = 0;
  apiMock.searchItems = [{ id: 's1', title: '胖东来回应', publishedAt: Date.now(), tags: [], sourceName: '源', summary: '', sourceCount: 1, hotScore: 50 }];
  const ctx = makeCtx();
  ctx.onTrendTap({ detail: { keyword: '胖东来', rank: 1 } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.segment, 'search');
  assert.strictEqual(ctx.data.searchKeyword, '胖东来');
  assert.strictEqual(apiMock.searchCalls[0].keyword, '胖东来');
  assert.strictEqual(ctx.data.searchItems.length, 1);
});

test('卡片点击跳转详情页', () => {
  navigations.length = 0;
  const ctx = makeCtx();
  ctx.onCardTap({ detail: { id: 'news-1' } });
  assert.strictEqual(navigations[0].url, '/pages/news/detail/index?id=news-1');
});

test('日期条进入归档页', () => {
  navigations.length = 0;
  const ctx = makeCtx();
  ctx.onArchiveTap();
  assert.ok(navigations[0].url.startsWith('/pages/news/archive/index?date='));
});

test('切到热榜分段懒加载，并格式化涨跌标签', async () => {
  apiMock.hot = [
    { id: 'h1', title: '热榜一', rank: 1, change: 'new', delta: 0, hotScore: 99, publishedAt: Date.now(), tags: [], sourceCount: 3, sourceName: '源' },
    { id: 'h2', title: '热榜二', rank: 2, change: 'up', delta: -2, hotScore: 90, publishedAt: Date.now(), tags: [], sourceCount: 1, sourceName: '源' },
    { id: 'h3', title: '热榜三', rank: 3, change: 'down', delta: 1, hotScore: 80, publishedAt: Date.now(), tags: [], sourceCount: 1, sourceName: '源' },
    { id: 'h4', title: '热榜四', rank: 4, change: 'same', delta: 0, hotScore: 70, publishedAt: Date.now(), tags: [], sourceCount: 1, sourceName: '源' }
  ];
  apiMock.hotResult = () => ({ ok: true, data: { items: apiMock.hot } });

  const ctx = makeCtx();
  ctx.onSegmentTap({ currentTarget: { dataset: { key: 'hot' } } });
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(ctx.data.segment, 'hot');
  assert.strictEqual(ctx.data.hotLoaded, true);
  assert.strictEqual(ctx.data.hotItems.length, 4);
  assert.strictEqual(ctx.data.hotItems[0].changeText, '新');
  assert.strictEqual(ctx.data.hotItems[1].changeText, '↑2');
  assert.strictEqual(ctx.data.hotItems[2].changeText, '↓1');
  assert.strictEqual(ctx.data.hotItems[3].changeText, '', '排名不变不显示标签');
});

test('热榜已加载后再次切换不重复请求', async () => {
  let hotCalls = 0;
  apiMock.hotResult = () => {
    hotCalls += 1;
    return { ok: true, data: { items: [] } };
  };
  const ctx = makeCtx();
  ctx.data.hotLoaded = true;
  ctx.onSegmentTap({ currentTarget: { dataset: { key: 'hot' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(hotCalls, 0);
});

test('热榜空数据给出空态文案，失败给错误态', async () => {
  apiMock.hotResult = () => ({ ok: true, data: { items: [] } });
  const ctx = makeCtx();
  ctx.onSegmentTap({ currentTarget: { dataset: { key: 'hot' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(ctx.data.hotItems, []);
  assert.strictEqual(ctx.data.hotError, '');

  apiMock.hotResult = () => ({ ok: false, error: { code: 'E_INTERNAL', message: '服务暂时不可用' } });
  const ctx2 = makeCtx();
  ctx2.onSegmentTap({ currentTarget: { dataset: { key: 'hot' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx2.data.hotError, '服务暂时不可用');
});

// ---------------- 搜索 ----------------

test('空关键词提交时提示，不发请求', async () => {
  apiMock.searchCalls.length = 0;
  toasts.length = 0;
  const ctx = makeCtx();
  ctx.data.searchKeyword = '   ';
  ctx.onSearchSubmit();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(apiMock.searchCalls.length, 0);
  assert.strictEqual(toasts[0].title, '请输入关键词');
});

test('提交搜索：请求 keyword/range、写入历史、切到搜索分段', async () => {
  apiMock.searchCalls.length = 0;
  apiMock.searchItems = [{ id: 's1', title: '公积金新政', publishedAt: Date.now(), tags: ['公积金'], sourceName: '源', summary: '', sourceCount: 1, hotScore: 50 }];
  const ctx = makeCtx();
  ctx.data.searchKeyword = ' 公积金 ';
  ctx.onSearchSubmit();
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(apiMock.searchCalls[0].keyword, '公积金');
  assert.strictEqual(apiMock.searchCalls[0].range, '30d');
  assert.strictEqual(ctx.data.segment, 'search');
  assert.strictEqual(ctx.data.searchSubmitted, true);
  assert.strictEqual(ctx.data.searchItems.length, 1);
  assert.deepStrictEqual(ctx.data.searchHistory, ['公积金']);
});

test('切换时间范围后重新搜索；历史去重并置顶', async () => {
  apiMock.searchCalls.length = 0;
  const ctx = makeCtx();
  ctx.data.searchKeyword = '公积金';
  ctx.data.searchSubmitted = true;
  ctx.data.searchHistory = ['消费券', '公积金'];
  ctx.onRangeTap({ currentTarget: { dataset: { key: '7d' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.searchRange, '7d');
  assert.strictEqual(apiMock.searchCalls[0].range, '7d');

  ctx.saveHistory('公积金');
  assert.deepStrictEqual(ctx.data.searchHistory, ['公积金', '消费券']);
});

test('搜索历史点击带入关键词并搜索', async () => {
  apiMock.searchCalls.length = 0;
  const ctx = makeCtx();
  ctx.onHistoryTap({ currentTarget: { dataset: { keyword: '消费券' } } });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.searchKeyword, '消费券');
  assert.strictEqual(apiMock.searchCalls[0].keyword, '消费券');
});

test('无结果时复制关键词（R-09.4）', async () => {
  const copied = [];
  global.wx.setClipboardData = (opt) => {
    copied.push(opt.data);
    if (opt.success) opt.success();
  };
  apiMock.searchItems = [];
  const ctx = makeCtx();
  ctx.data.searchKeyword = '冷门词';
  ctx.data.searchItems = [];
  ctx.onCopyKeyword();
  assert.deepStrictEqual(copied, ['冷门词']);
});

test('搜索失败展示错误态，重试重新请求', async () => {
  apiMock.searchCalls.length = 0;
  apiMock.searchResult = () => ({ ok: false, error: { code: 'E_NETWORK', message: '网络不给力，点我重试' } });
  const ctx = makeCtx();
  ctx.data.searchKeyword = '公积金';
  ctx.onSearchSubmit();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.searchError, '网络不给力，点我重试');

  const before = apiMock.searchCalls.length;
  ctx.onSearchRetry();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(apiMock.searchCalls.length, before + 1);
  apiMock.searchResult = () => ({ ok: true, data: { items: [], total: 0, hasMore: false, page: 1 } });
});

test('R-18：服务端回退昨日数据时显示黄色提示', async () => {
  const yesterday = new Date(Date.now() - 86400000);
const dayUtil = require('../../utils/date');
apiMock.listResult = () => ({
    items: [{ id: 'y1', title: '昨天的新闻', publishedAt: yesterday.getTime(), tags: [], sourceName: '源', summary: '', sourceCount: 1, hotScore: 50 }],
    total: 1,
    hasMore: false,
    day: dayUtil.formatDay(yesterday.getTime()),
    updatedAt: Date.now() - 3600000,
    fallback: true,
    page: 1
  });
  const ctx = makeCtx();
  ctx.onLoad();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(ctx.data.noticeText.includes('数据更新于'), ctx.data.noticeText);
  assert.ok(ctx.data.noticeText.includes('昨天'), ctx.data.noticeText);
  assert.strictEqual(ctx.data.items.length, 1);

  apiMock.listResult = () => ({ items: [], total: 0, hasMore: false, day: '2026-11-08', updatedAt: 0, page: 1 });
  const ctx2 = makeCtx();
  ctx2.onLoad();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx2.data.noticeText, '');
});

test('空态次按钮「看热点」清空分类与标签并重新加载', async () => {
  apiMock.calls.length = 0;
  const ctx = makeCtx();
  ctx.data.category = 'hangzhou';
  ctx.data.tag = '公积金';
  ctx.onBackToHot();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.category, '');
  assert.strictEqual(ctx.data.tag, '');
  assert.strictEqual(apiMock.calls[apiMock.calls.length - 1].category, undefined);
});

test('搜索分段触底加载下一页并追加', async () => {
  apiMock.searchCalls.length = 0;
  apiMock.searchResult = () => ({ ok: true, data: { items: [{ id: 's2', title: '第二页', publishedAt: Date.now(), tags: [], sourceName: '源', summary: '', sourceCount: 1, hotScore: 40 }], total: 3, hasMore: true, page: 2 } });
  const ctx = makeCtx();
  ctx.data.segment = 'search';
  ctx.data.searchKeyword = '公积金';
  ctx.data.searchItems = [{ id: 's1' }];
  ctx.data.searchPage = 1;
  ctx.data.searchHasMore = true;

  ctx.onReachBottom();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ctx.data.searchItems.length, 2);
  assert.strictEqual(apiMock.searchCalls[0].page, 2);
  apiMock.searchResult = () => ({ ok: true, data: { items: [], total: 0, hasMore: false, page: 1 } });
});
