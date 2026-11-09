#!/usr/bin/env node
// scripts/init-collections.js
// T-03：创建 7 个集合，并打印索引清单（云开发控制台手动建索引；SDK 不支持建索引）。
// 用法：
//   node scripts/init-collections.js           # 真建集合
//   node scripts/init-collections.js --print   # 只打印计划
// 前置：cloudfunctions/news 下已 npm install（需要 wx-server-sdk），且本机已登录云开发环境。
const path = require('node:path');

const COLLECTIONS = ['news', 'events', 'sources', 'daily_hot', 'fetch_logs', 'config', 'events_log'];

// 与 docs/API.md §2 的索引声明一一对应
const INDEXES = [
  { collection: 'news', name: 'url_hash', fields: ['url_hash'], unique: true },
  { collection: 'news', name: 'day_primary_cat_pub', fields: ['day', 'is_trend', 'is_primary', 'category', 'published_at'], unique: false },
  { collection: 'news', name: 'day_primary_hot', fields: ['day', 'is_trend', 'is_primary', 'hot_score'], unique: false },
  { collection: 'news', name: 'day_trend_rank', fields: ['day', 'is_trend', 'rank'], unique: false },
  { collection: 'news', name: 'event_id', fields: ['event_id'], unique: false },
  { collection: 'news', name: 'published_at', fields: ['published_at'], unique: false },
  { collection: 'events', name: 'day_hot', fields: ['day', 'hot_score'], unique: false },
  { collection: 'sources', name: 'id', fields: ['id'], unique: true },
  { collection: 'sources', name: 'enabled', fields: ['enabled'], unique: false },
  { collection: 'daily_hot', name: 'date_rank', fields: ['date', 'rank'], unique: true },
  { collection: 'fetch_logs', name: 'run_at', fields: ['run_at'], unique: false },
  { collection: 'fetch_logs', name: 'source_run', fields: ['source_id', 'run_at'], unique: false }
];

function printPlan() {
  console.log('集合：');
  for (const c of COLLECTIONS) console.log('  - ' + c);
  console.log('索引（云开发控制台 → 数据库 → 索引管理，逐条新建）：');
  for (const i of INDEXES) {
    const mode = i.unique ? '唯一' : '非唯一';
    console.log(`  - ${i.collection}.${i.name}：${i.fields.join(' + ')}（${mode}）`);
  }
}

function loadSDK() {
  const candidates = [
    'wx-server-sdk',
    path.join(__dirname, '..', 'cloudfunctions', 'news', 'node_modules', 'wx-server-sdk')
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch (err) {
      /* 尝试下一个 */
    }
  }
  throw new Error('未找到 wx-server-sdk：请先在 cloudfunctions/news 下执行 npm install');
}

async function main() {
  const printOnly = process.argv.includes('--print');
  printPlan();
  if (printOnly) {
    console.log('\n--print 模式：未连接云开发环境。');
    return;
  }

  const cloud = loadSDK();
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const db = cloud.database();

  let created = 0;
  let existed = 0;
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      created += 1;
      console.log(`创建集合 ${name}`);
    } catch (err) {
      // -501001 / ResourceUnavailable：集合已存在
      const msg = String((err && err.message) || err);
      if (/exist/i.test(msg) || /-501001/.test(msg)) {
        existed += 1;
        console.log(`集合已存在 ${name}`);
      } else {
        console.error(`创建集合失败 ${name}: ${msg}`);
        throw err;
      }
    }
  }

  console.log(`\n完成：新建 ${created} 个，已存在 ${existed} 个。`);
  console.log('索引需要在控制台手动创建，清单见上方输出。');
  console.log(`共 ${INDEXES.length} 条索引。`);
}

main().catch((err) => {
  console.error('\n失败：' + ((err && err.message) || err));
  console.error('请确认：1) cloudfunctions/news 已 npm install；2) 已用微信开发者工具登录云开发环境；3) config/index.js 的 CLOUD_ENV 正确。');
  process.exit(1);
});
