// scripts/devtools-go-live.cjs
// 初始化云数据库（bootstrap）→ 触发一轮抓取（fetch）→ 轮询列表确认数据入库。
const automator = require('miniprogram-automator');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  console.log('connected');

  // 1) bootstrap：建集合 + 导入 19 源
  const boot = await mp.evaluate(async function () {
    try {
      const r = await wx.cloud.callFunction({ name: 'news', data: { action: 'bootstrap' } });
      return r.result;
    } catch (e) {
      return { error: [e && e.errCode, e && e.errMsg].filter(Boolean).join(' | ') };
    }
  });
  console.log('bootstrap:', JSON.stringify(boot).slice(0, 400));

  // 2) 触发抓取（开发者工具内一次性手动触发：模拟定时器事件）
  //    客户端调用会先超时，服务端继续跑，因此这里只负责「点着」，随后轮询数据库。
  const fire = await mp.evaluate(function () {
    try {
      wx.cloud
        .callFunction({ name: 'news', data: { action: 'fetch', Type: 'Timer' } })
        .then(function (r) { console.log('fetch result', JSON.stringify(r.result).slice(0, 300)); })
        .catch(function (e) { console.log('fetch error', e && e.errMsg); });
      return { fired: true };
    } catch (e) {
      return { error: [e && e.errCode, e && e.errMsg].filter(Boolean).join(' | ') };
    }
  });
  console.log('fetch:', JSON.stringify(fire));

  // 3) 轮询 listNews，最多等 90 秒
  for (let i = 0; i < 18; i += 1) {
    await sleep(5000);
    const check = await mp.evaluate(async function () {
      try {
        const r = await wx.cloud.callFunction({ name: 'news', data: { action: 'listNews', pageSize: 1 } });
        const d = (r.result && r.result.data) || {};
        return { ok: r.result && r.result.ok, total: d.total, items: (d.items || []).length, error: r.result && r.result.error };
      } catch (e) {
        return { error: [e && e.errCode, e && e.errMsg].filter(Boolean).join(' | ') };
      }
    });
    console.log(`poll ${i + 1}:`, JSON.stringify(check).slice(0, 300));
    if (check && check.ok && check.total > 0) break;
  }

  await mp.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('failed:', err && err.message ? err.message : err);
  process.exit(1);
});
