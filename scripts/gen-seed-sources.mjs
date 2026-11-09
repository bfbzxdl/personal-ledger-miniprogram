// scripts/gen-seed-sources.mjs
// 从 docs/SOURCES.yaml 生成 cloudfunctions/news/lib/seed-sources.js（云函数不带 YAML 依赖）。
// 用法：node scripts/gen-seed-sources.mjs [--check]
//   --check 只比对、不写盘；不一致时退出码 1（供单测/CI 使用）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSourcesYaml } from './lib/parse-sources-yaml.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
export const YAML_PATH = join(ROOT, 'docs', 'SOURCES.yaml');
export const OUT_PATH = join(ROOT, 'cloudfunctions', 'news', 'lib', 'seed-sources.js');

const SOURCE_FIELDS = [
  'id', 'name', 'category', 'kind', 'adapter', 'url', 'linkMatch',
  'weight', 'enabled', 'verified', 'issuer', 'note', 'titleStrip'
];

/** 生成可直接 require 的 CommonJS 模块源码；键顺序固定，保证幂等 */
export function buildSeedModule(yamlText) {
  const doc = parseSourcesYaml(yamlText);
  if (!Array.isArray(doc.sources) || !doc.sources.length) {
    throw new Error('SOURCES.yaml 缺少 sources');
  }
  if (!Array.isArray(doc.tag_rules) || !doc.tag_rules.length) {
    throw new Error('SOURCES.yaml 缺少 tag_rules');
  }

  const sources = doc.sources.map((raw) => {
    const one = {};
    for (const f of SOURCE_FIELDS) {
      if (raw[f] !== undefined) one[f] = raw[f];
    }
    return one;
  });

  const rules = doc.tag_rules.map((r) => ({ tag: r.tag, keywords: r.keywords || [] }));

  const relevance = (doc.relevance_filters || []).map((r) => ({
    id: r.id,
    anyKeywords: r.anyKeywords || [],
    excludeKeywords: r.excludeKeywords || []
  }));

  const body = {
    version: doc.version,
    testedAt: doc.tested_at,
    tagRules: rules,
    relevanceFilters: relevance,
    sources
  };

  return [
    '// 由 scripts/gen-seed-sources.mjs 从 docs/SOURCES.yaml 生成，请勿手改。',
    '// 校验：node scripts/gen-seed-sources.mjs --check',
    'module.exports = ' + JSON.stringify(body, null, 2) + ';',
    ''
  ].join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const yamlText = readFileSync(YAML_PATH, 'utf8');
  const next = buildSeedModule(yamlText);
  const check = process.argv.includes('--check');
  if (check) {
    const prev = readFileSync(OUT_PATH, 'utf8');
    if (prev !== next) {
      console.error('seed-sources.js 与 SOURCES.yaml 不一致，请运行 node scripts/gen-seed-sources.mjs');
      process.exit(1);
    }
    console.log('seed-sources.js 与 SOURCES.yaml 一致');
  } else {
    writeFileSync(OUT_PATH, next, 'utf8');
    const doc = parseSourcesYaml(yamlText);
    console.log(`已生成 ${OUT_PATH}`);
    console.log(`源 ${doc.sources.length} 个，标签规则 ${doc.tag_rules.length} 条`);
  }
}
