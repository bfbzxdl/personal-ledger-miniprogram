// cloudfunctions/news/lib/respond.js
// 统一响应封装：{ ok:true, data } / { ok:false, error:{ code, message } }，见 docs/API.md §3。
const { ERR } = require('./const');

const DEFAULT_MESSAGE = {
  [ERR.PARAM]: 'invalid parameter',
  [ERR.NOT_FOUND]: 'not found',
  [ERR.RATE_LIMIT]: 'too many requests',
  [ERR.SOURCE]: 'source fetch failed',
  [ERR.INTERNAL]: 'service unavailable',
  [ERR.FORBIDDEN]: 'forbidden'
};

function ok(data) {
  return { ok: true, data: data === undefined ? {} : data };
}

function fail(code, message) {
  const known = Object.prototype.hasOwnProperty.call(DEFAULT_MESSAGE, code);
  return {
    ok: false,
    error: {
      code: known ? code : ERR.INTERNAL,
      message: String(message || DEFAULT_MESSAGE[known ? code : ERR.INTERNAL])
    }
  };
}

module.exports = { ok, fail };
