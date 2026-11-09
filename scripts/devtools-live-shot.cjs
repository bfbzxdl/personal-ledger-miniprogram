// 临时：用真实云数据截图（不注入）
const automator = require('miniprogram-automator');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const which = process.argv[2];
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  if (which === 'home') {
    await mp.switchTab('/pages/news/home/index');
    await sleep(4000);
  } else if (which === 'hot') {
    await mp.switchTab('/pages/news/home/index');
    await sleep(2500);
    const page = await mp.currentPage();
    await page.setData({ segment: 'hot' });
    await sleep(3000);
  } else if (which === 'detail') {
    const id = await mp.evaluate(async function () {
      const r = await wx.cloud.callFunction({ name: 'news', data: { action: 'listNews', pageSize: 1 } });
      return (r.result.data.items || [])[0].id;
    });
    await mp.reLaunch('/pages/news/detail/index?id=' + id);
    await sleep(3500);
  } else if (which === 'archive') {
    const day = await mp.evaluate(function () {
      const d = new Date(Date.now());
      const p = (n) => (n < 10 ? '0' + n : '' + n);
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    });
    await mp.reLaunch('/pages/news/archive/index?date=' + day);
    await sleep(3500);
  }
  await mp.screenshot({ path: path.join('out', 'devtools', 'live-' + which + '.png') });
  console.log('saved live-' + which);
  await mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('failed', e && e.message);
  process.exit(1);
});
