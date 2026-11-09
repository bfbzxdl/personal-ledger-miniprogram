// cloudfunctions/news/lib/fetch.js
// T-04：HTTP 抓取适配层。超时 / 重试 / 页面限速见 REQ §1 与 R-02。
const { C } = require('./const');

// D-18：云函数运行时可能仍为 Node 16（无全局 fetch），用 node-fetch@2 兜底
const fetchImpl = typeof fetch === 'function' ? fetch : require('node-fetch');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

let lastHtmlAt = 0;
let htmlQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTML/trend 抓取严格串行（R-02.4）：
 * 排队执行，前一个请求结束后再等够 HTML_REQ_INTERVAL_MS，才发起下一个。
 */
function withHtmlLock(task) {
  const run = htmlQueue.then(async () => {
    const wait = lastHtmlAt + C.HTML_REQ_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHtmlAt = Date.now();
    return task();
  });
  htmlQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

/** 仅测试用：重置限速状态 */
function __resetThrottle() {
  lastHtmlAt = 0;
  htmlQueue = Promise.resolve();
}

/** 按 content-type/charset 或页面 meta 声明解码；失败退回 utf-8 */
function decode(buf, contentType) {
  const bytes = Buffer.from(buf);
  const head = bytes.subarray(0, 2048).toString('latin1');
  const fromHeader = (String(contentType || '').match(/charset=([\w-]+)/i) || [])[1];
  const fromMeta = (head.match(/charset=["']?([\w-]+)/i) || [])[1];
  const cs = String(fromHeader || fromMeta || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch (err) {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function requestOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: '*/*' },
      redirect: 'follow'
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      ms: Date.now() - startedAt,
      text: decode(buf, res.headers.get('content-type') || '')
    };
  } catch (err) {
    const isTimeout = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
    const e = new Error(isTimeout ? 'timeout' : String((err && err.message) || err));
    e.timeout = isTimeout;
    e.ms = Date.now() - startedAt;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 抓取单个 URL：超时 FETCH_TIMEOUT_MS，失败重试 FETCH_RETRY 次（间隔 FETCH_RETRY_DELAY_MS）。
 * @returns {Promise<{status:number, ms:number, text:string}>}
 */
async function fetchText(url, options) {
  const opts = options || {};
  const timeoutMs = opts.timeoutMs || C.FETCH_TIMEOUT_MS;
  const retry = opts.retry === undefined ? C.FETCH_RETRY : opts.retry;
  const serial = opts.serial === true; // html / trend 源
  const attempts = retry + 1;
  let lastErr = null;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const run = () => requestOnce(url, timeoutMs);
      const res = serial ? await withHtmlLock(run) : await run();
      if (res.status >= 400) {
        const e = new Error('HTTP ' + res.status);
        e.status = res.status;
        throw e;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await sleep(opts.retryDelayMs || C.FETCH_RETRY_DELAY_MS);
    }
  }

  const e = new Error(lastErr ? lastErr.message : 'fetch failed');
  e.timeout = Boolean(lastErr && lastErr.timeout);
  e.ms = Date.now() - startedAt;
  throw e;
}

/** 抓取并按源配置判定是否需要串行限速 */
async function fetchSource(source, options) {
  const serial = source.adapter === 'html' || source.adapter === 'trend';
  const res = await fetchText(source.url, Object.assign({ serial: serial }, options));
  return { sourceId: source.id, url: source.url, status: res.status, ms: res.ms, text: res.text };
}

module.exports = { fetchText, fetchSource, decode, withHtmlLock, sleep, __resetThrottle, UA };
