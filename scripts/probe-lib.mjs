// scripts/probe-lib.mjs
// T-04 验收：用云函数内的 fetch + parse 跑一遍 17 个源，输出每条源的条数与样例。
// 用法：node scripts/probe-lib.mjs [--min 5]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { fetchSource } = require('../cloudfunctions/news/lib/fetch.js');
const { parseSource } = require('../cloudfunctions/news/lib/parse.js');
const { SEED } = require('../cloudfunctions/news/lib/seed.js');
const { C } = require('../cloudfunctions/news/lib/const.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const minIdx = process.argv.indexOf('--min');
const MIN = minIdx > 0 ? Number(process.argv[minIdx + 1]) : 5;

async function runOne(source, now) {
  const startedAt = Date.now();
  try {
    const res = await fetchSource(source);
    const parsed = parseSource(source, res.text, { now });
    const fresh = parsed.items.filter((it) => !it.stale);
    return {
      source,
      status: parsed.items.length ? 'ok' : 'empty',
      http: res.status,
      ms: Date.now() - startedAt,
      count: parsed.items.length,
      fresh: fresh.length,
      items: parsed.items,
      error: ''
    };
  } catch (err) {
    return {
      source,
      status: err && err.timeout ? 'timeout' : 'fail',
      http: 0,
      ms: Date.now() - startedAt,
      count: 0,
      fresh: 0,
      items: [],
      error: String((err && err.message) || err)
    };
  }
}

async function pool(list, size, worker) {
  const results = new Array(list.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, list.length) }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= list.length) return;
      results[idx] = await worker(list[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

const now = Date.now();
const sources = SEED.sources;
console.log(`共 ${sources.length} 个源，并发 ${C.FETCH_BATCH}，单源超时 ${C.FETCH_TIMEOUT_MS}ms，最小条数 ${MIN}\n`);

const startedAt = Date.now();
const results = await pool(sources, C.FETCH_BATCH, (s) => runOne(s, now));
const totalMs = Date.now() - startedAt;

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('ID', 16) + pad('适配器', 8) + pad('状态', 9) + pad('条数', 6) + pad('新', 5) + '耗时');
for (const r of results) {
  console.log(
    pad(r.source.id, 16) +
      pad(r.source.adapter, 8) +
      pad(r.status, 9) +
      pad(r.count, 6) +
      pad(r.fresh, 5) +
      r.ms + 'ms' +
      (r.error ? '  ' + r.error : '')
  );
}

console.log('\n样例（每源首条）：');
for (const r of results) {
  if (r.items.length) {
    const it = r.items[0];
    console.log(`  [${r.source.category}] ${r.source.name}：${it.title.slice(0, 40)} → ${it.url.slice(0, 60)}`);
  }
}

const bad = results.filter((r) => r.status !== 'ok' || r.count < MIN);
console.log(`\n总耗时 ${totalMs}ms；达标 ${results.length - bad.length}/${results.length}`);
if (bad.length) {
  console.log('未达标：' + bad.map((r) => `${r.source.id}(${r.status},${r.count})`).join(', '));
}

mkdirSync(join(ROOT, 'out'), { recursive: true });
const stamp = new Date(now + C.TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
const path = join(ROOT, 'out', `probe-lib-${stamp}.json`);
writeFileSync(
  path,
  JSON.stringify(
    {
      at: new Date(now).toISOString(),
      minItems: MIN,
      totalMs,
      results: results.map((r) => ({
        id: r.source.id,
        name: r.source.name,
        adapter: r.source.adapter,
        status: r.status,
        http: r.http,
        ms: r.ms,
        count: r.count,
        fresh: r.fresh,
        error: r.error,
        items: r.items.slice(0, 5)
      }))
    },
    null,
    2
  ),
  'utf8'
);
console.log(`输出：${path}`);
process.exit(bad.length ? 1 : 0);
