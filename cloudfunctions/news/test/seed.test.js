// cloudfunctions/news/test/seed.test.js
// T-03 验收：sources 全部种子条且 verified=true；config/tag_rules 8 条；重复执行不产生重复。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { seedSources, seedSourceList, SEED } = require('../lib/seed');
const { route } = require('../index');
const { createFakeDB } = require('./helpers/fake-db');

const SRC_COUNT = SEED.sources.length;

const YAML_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'SOURCES.yaml');

test('种子数据：全部源 8 类标签、全部 verified', () => {
  assert.strictEqual(SEED.sources.length, SRC_COUNT);
  assert.strictEqual(SEED.tagRules.length, 8);
  assert.ok(SEED.sources.every((s) => s.verified === true));
  // 每个源必有 id/category/kind/adapter/url
  for (const s of SEED.sources) {
    for (const f of ['id', 'name', 'category', 'kind', 'adapter', 'url']) {
      assert.ok(s[f], `${s.id || '?'} 缺少字段 ${f}`);
    }
    assert.ok(['rss', 'json', 'html', 'trend'].includes(s.adapter), `${s.id} adapter 非法`);
    assert.ok(['finance', 'policy', 'world', 'hangzhou', 'general'].includes(s.category), `${s.id} category 非法`);
  }
  // html 源必须带 linkMatch，trend 源必须是 kind=trend
  for (const s of SEED.sources) {
    if (s.adapter === 'html') assert.ok(s.linkMatch, `${s.id} 缺少 linkMatch`);
    if (s.adapter === 'trend') assert.strictEqual(s.kind, 'trend');
  }
});

test('seed-sources.js 与 docs/SOURCES.yaml 保持一致（防止手改生成文件）', async () => {
  const { buildSeedModule } = await import('../../../scripts/gen-seed-sources.mjs');
  const fs = require('node:fs');
  const yamlText = fs.readFileSync(YAML_PATH, 'utf8');
  const expected = buildSeedModule(yamlText);
  const actual = fs.readFileSync(path.join(__dirname, '..', 'lib', 'seed-sources.js'), 'utf8');
  assert.strictEqual(actual, expected, '请运行 node scripts/gen-seed-sources.mjs 重新生成');
});

test('首次执行：写入全部源 + 1 个 tag_rules 文档', async () => {
  const db = createFakeDB();
  const res = await seedSources(db, { now: new Date('2026-11-08T00:00:00Z') });
  assert.deepStrictEqual(
    { inserted: res.inserted, updated: res.updated, tagRules: res.tagRules },
    { inserted: SRC_COUNT, updated: 0, tagRules: 8 }
  );
  assert.strictEqual(db.__size('sources'), SRC_COUNT);
  const cfg = db.__dump('config');
  assert.strictEqual(cfg.length, 1);
  assert.strictEqual(cfg[0]._id, 'tag_rules');
  assert.strictEqual(cfg[0].rules.length, 8);
  assert.deepStrictEqual(cfg[0].rules[0].tag, '社保医保');
  assert.ok(cfg[0].rules[0].keywords.includes('社保'));
  assert.ok(cfg[0].rules[0].keywords.includes('养老金'), 'R-14 扩充词应包含养老金');
  // 新增源带有运行期字段初始值
  const one = db.__dump('sources')[0];
  assert.strictEqual(one.fail_count, 0);
  assert.strictEqual(one.last_fetch_at, null);
  assert.strictEqual(one.disabled_reason, '');
});

test('重复执行：不新增记录，只更新（幂等）', async () => {
  const db = createFakeDB();
  await seedSources(db, { now: new Date('2026-11-08T00:00:00Z') });
  const second = await seedSources(db, { now: new Date('2026-11-09T00:00:00Z') });
  assert.strictEqual(second.inserted, 0);
  assert.strictEqual(second.updated, SRC_COUNT);
  assert.strictEqual(db.__size('sources'), SRC_COUNT);
  assert.strictEqual(db.__size('config'), 1);
});

test('重新导入不覆盖运行期统计字段', async () => {
  const db = createFakeDB();
  await seedSources(db);
  const before = db.__dump('sources').find((s) => s.id === 'cls');
  await db.collection('sources').doc(before._id).update({ data: { fail_count: 3, disabled_reason: 'x' } });
  await seedSources(db);
  const after = db.__dump('sources').find((s) => s.id === 'cls');
  assert.strictEqual(after.fail_count, 3);
  assert.strictEqual(after.disabled_reason, 'x');
});

test('seedSources 需要正确的 ADMIN_TOKEN', async () => {
  const db = createFakeDB();
  const bad = await route({ action: 'seedSources', adminToken: 'nope' }, { db, adminToken: 'token-123' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error.code, 'E_FORBIDDEN');
  assert.strictEqual(db.__size('sources'), 0);

  const good = await route({ action: 'seedSources', adminToken: 'token-123' }, { db, adminToken: 'token-123' });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.data.inserted, SRC_COUNT);
  assert.strictEqual(good.data.tagRules, 8);
  assert.strictEqual(db.__size('sources'), SRC_COUNT);
});

test('seedSourceList 输出全部源、字段齐全（供抓取使用）', () => {
  const list = seedSourceList();
  assert.strictEqual(list.length, SRC_COUNT);
  for (const s of list) {
    assert.ok(s.id && s.url && s.adapter && s.category && s.kind);
    assert.strictEqual(typeof s.weight, 'number');
    assert.strictEqual(typeof s.enabled, 'boolean');
  }
});

test('D-17：bootstrap 空库首次调用建集合+导种子，重复调用需 token', async () => {
  const saveToken = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  try {
    const db = createFakeDB();
    const first = await route({ action: 'bootstrap' }, { db });
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    assert.strictEqual(first.data.created.length, 7, '应创建 7 个集合');
    assert.strictEqual(db.__size('sources'), SRC_COUNT);
    assert.strictEqual(db.__size('config'), 1);
    assert.strictEqual(db.__size('news'), 0);

    const second = await route({ action: 'bootstrap' }, { db });
    assert.strictEqual(second.ok, false, '重复初始化应被拒绝');
    assert.strictEqual(second.error.code, 'E_FORBIDDEN');

    const withToken = await route({ action: 'bootstrap', adminToken: 'k' }, { db, adminToken: 'k' });
    assert.strictEqual(withToken.ok, true, '带正确 token 时可重复执行');
  } finally {
    if (saveToken !== undefined) process.env.ADMIN_TOKEN = saveToken;
  }
});


