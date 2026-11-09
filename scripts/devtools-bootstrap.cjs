// scripts/devtools-bootstrap.cjs
// 在开发者工具里调用云函数：bootstrap（建集合+种子）→ listNews（验证查询可用）。
const automator = require('miniprogram-automator');

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const out = await mp.evaluate(async function () {
    const result = {};
    try {
      const r = await wx.cloud.callFunction({ name: 'news', data: { action: 'bootstrap' } });
      result.bootstrap = r.result;
    } catch (e) {
      result.bootstrapError = [e && e.errCode, e && e.errMsg].filter(Boolean).join(' | ');
    }
    try {
      const q = await wx.cloud.callFunction({ name: 'news', data: { action: 'listNews' } });
      const d = (q.result && q.result.data) || {};
      result.listNews = { ok: q.result && q.result.ok, total: d.total, items: (d.items || []).length, error: q.result && q.result.error };
    } catch (e) {
      result.listNewsError = [e && e.errCode, e && e.errMsg].filter(Boolean).join(' | ');
    }
    return result;
  });
  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('failed:', err && err.message ? err.message : err);
  process.exit(1);
});
