// scripts/devtools-diagnose.cjs
// 在开发者工具里复现热点页请求失败，打印 wx.cloud 调用与错误码。
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  console.log('connected');

  for (let i = 0; i < 30; i += 1) {
    try {
      if (await mp.currentPage()) break;
    } catch (e) {
      /* compile */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 1) 云能力与 ping
  const probe = await mp.evaluate(async function () {
    const out = { cloud: !!wx.cloud, env: null, db: null, ping: null, pingError: null };
    try {
      if (wx.cloud && wx.cloud.database) {
        out.db = 'database() ok';
      }
    } catch (e) {
      out.db = 'database() failed: ' + (e && e.message);
    }
    try {
      const r = await wx.cloud.callFunction({ name: 'news', data: { action: 'ping' } });
      out.ping = JSON.stringify(r && r.result);
    } catch (e) {
      out.pingError = [e && e.errCode, e && e.errMsg, e && e.message].filter(Boolean).join(' | ');
    }
    return out;
  });
  console.log('probe:', JSON.stringify(probe, null, 2));

  // 2) 打开热点页，读取页面状态与 app 全局云环境
  await mp.switchTab('/pages/news/home/index');
  await new Promise((r) => setTimeout(r, 4000));
  const page = await mp.currentPage();
  const data = await page.data();
  console.log('page:', page.path);
  console.log('state:', JSON.stringify({ error: data.error, emptyText: data.emptyText, items: (data.items || []).length }));

  const info = await mp.evaluate(function () {
    const app = getApp();
    return {
      cloudEnv: (app && app.globalData && app.globalData.cloudEnv) || null,
      version: wx.getAccountInfoSync ? wx.getAccountInfoSync().miniProgram.envVersion : 'unknown'
    };
  });
  console.log('app:', JSON.stringify(info));

  await mp.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('diagnose failed:', err && err.message ? err.message : err);
  process.exit(1);
});
