// scripts/devtools-shot.cjs <home|hot|detail|archive>
// 每次只做「一页」截图：连接 → 导航 → 注入数据 → 截图 → 断开。
// 经验：同一次连接里连续多次截图容易卡住自动化通道，分进程执行最稳。
const automator = require('miniprogram-automator');
const fs = require('node:fs');
const path = require('node:path');
const dateUtil = require('../utils/date.js');
const data = require('../out/preview/data.json');

const OUT = path.join(__dirname, '..', 'out', 'devtools');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const which = process.argv[2];

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function buildCells(cal, day) {
  const parts = cal.month.split('-');
  const year = Number(parts[0]);
  const mon = Number(parts[1]);
  const firstWeekday = new Date(year, mon - 1, 1).getDay();
  const daysInMonth = new Date(year, mon, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push({ key: 'pad-' + i, day: '', label: '', empty: true, disabled: true, hasData: false, count: 0 });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dayStr = `${year}-${pad2(mon)}-${pad2(d)}`;
    const count = cal.counts[dayStr] || 0;
    cells.push({
      key: dayStr,
      day: dayStr,
      label: String(d),
      empty: false,
      count: count,
      hasData: count > 0,
      disabled: (cal.minDay && dayStr < cal.minDay) || dayStr > cal.maxDay,
      isToday: dayStr === cal.maxDay,
      isSelected: dayStr === day
    });
  }
  return cells;
}

function withChange(items) {
  return items.map((item) => {
    const delta = item.delta || 0;
    const text =
      item.change === 'up' ? '↑' + Math.abs(delta) : item.change === 'down' ? '↓' + Math.abs(delta) : item.change === 'new' ? '新' : '';
    return Object.assign({}, item, { changeText: text, changeType: item.change || '' });
  });
}

async function waitReady(mp) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const page = await mp.currentPage();
      if (page) return page;
    } catch (err) {
      /* 编译中 */
    }
    await sleep(1000);
  }
  throw new Error('小程序尚未就绪');
}

(async () => {
  if (!which) throw new Error('用法: node scripts/devtools-shot.cjs <home|hot|detail|archive>');
  fs.mkdirSync(OUT, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  await waitReady(mp);

  if (which === 'home') {
    await mp.switchTab('/pages/news/home/index');
    await sleep(2500);
    const page = await mp.currentPage();
    await page.setData({
      items: data.list.items,
      total: data.list.total,
      hasMore: false,
      trends: data.trends.items,
      skeleton: false,
      error: '',
      emptyText: '',
      noticeText: '',
      updatedText: data.list.updatedAt ? '更新于 ' + dateUtil.formatClock(data.list.updatedAt) : ''
    });
  } else if (which === 'hot') {
    await mp.switchTab('/pages/news/home/index');
    await sleep(2500);
    let page = await mp.currentPage();
    await page.setData({ segment: 'hot' });
    await sleep(600);
    page = await mp.currentPage();
    await page.setData({ hotItems: withChange(data.hot.items), hotLoaded: true, hotLoading: false, hotError: '' });
  } else if (which === 'detail') {
    await mp.reLaunch('/pages/news/detail/index?id=' + data.list.items[0].id);
    await sleep(2000);
    const page = await mp.currentPage();
    const n = data.detail.news;
    await page.setData({
      loading: false,
      error: '',
      news: n,
      related: data.detail.related,
      contentHtml: n.contentHtml || '',
      truncated: false,
      isPolicy: n.category === 'policy',
      timeText: dateUtil.formatDateTime(n.publishedAt)
    });
  } else if (which === 'archive') {
    await mp.reLaunch('/pages/news/archive/index?date=' + data.day);
    await sleep(2000);
    const page = await mp.currentPage();
    await page.setData({
      loading: false,
      error: '',
      month: data.archive.calendar.month,
      monthText: data.archive.calendar.month.replace('-', ' 年 ') + ' 月',
      minDay: data.archive.calendar.minDay,
      maxDay: data.archive.calendar.maxDay,
      selectedDay: data.day,
      selectedText: dateUtil.formatDayText(data.day),
      cells: buildCells(data.archive.calendar, data.day),
      items: data.archive.items,
      listTotal: data.archive.total,
      listLoading: false,
      canPrev: false,
      canNext: false
    });
  } else {
    throw new Error('未知页面: ' + which);
  }

  await sleep(2000);
  await mp.screenshot({ path: path.join(OUT, which + '.png') });
  console.log(which + '.png done');
  await mp.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('failed:', err && err.message ? err.message : err);
  process.exit(1);
});
