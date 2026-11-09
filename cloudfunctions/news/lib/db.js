// cloudfunctions/news/lib/db.js
// 懒加载 wx-server-sdk：仅在实际读写数据库时 require，
// 这样 index.js 的路由与纯函数可以在 node:test 中直接测试，无需安装云端依赖。
let sdk = null;

function cloud() {
  if (!sdk) {
    // eslint-disable-next-line global-require
    sdk = require('wx-server-sdk');
    sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV });
  }
  return sdk;
}

function getDB() {
  return cloud().database();
}

module.exports = { getDB, cloud };
