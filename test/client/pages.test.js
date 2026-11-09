// test/client/pages.test.js
// 页面静态校验：文件齐全、WXML class 均有样式、usingComponents 指向真实组件、已在 app.json 注册。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PAGES = ['pages/news/home/index', 'pages/news/detail/index', 'pages/news/archive/index'];

function staticClasses(wxml) {
  const out = new Set();
  const re = /class="([^"]*)"/g;
  let m;
  while ((m = re.exec(wxml))) {
    const part = m[1].replace(/\{\{[^}]*\}\}/g, ' ');
    for (const token of part.split(/\s+/)) {
      // 形如 change-{{type}} 的动态后缀类不参与静态校验
      if (token && !token.endsWith('-')) out.add(token);
    }
  }
  return out;
}

for (const page of PAGES) {
  test(`${page}：js/wxml/wxss/json 齐全且已被 app.json 注册`, () => {
    for (const ext of ['.js', '.wxml', '.wxss', '.json']) {
      assert.ok(fs.existsSync(path.join(ROOT, page + ext)), '缺少 ' + page + ext);
    }
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
    assert.ok(app.pages.includes(page), page + ' 未注册到 app.json');
  });

  test(`${page}：WXML 中静态 class 均有对应样式`, () => {
    const wxml = fs.readFileSync(path.join(ROOT, page + '.wxml'), 'utf8');
    // 页面样式 + 全局 app.wxss（.card 等公共类）
    const wxss =
      fs.readFileSync(path.join(ROOT, page + '.wxss'), 'utf8') +
      fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8');
    const classes = staticClasses(wxml);
    assert.ok(classes.size > 0);
    for (const c of classes) {
      assert.ok(wxss.includes('.' + c), `WXSS 缺少 .${c}`);
    }
  });

  test(`${page}：usingComponents 指向存在的组件`, () => {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, page + '.json'), 'utf8'));
    const using = json.usingComponents || {};
    for (const [name, target] of Object.entries(using)) {
      const base = target.startsWith('/') ? path.join(ROOT, target) : path.resolve(path.join(ROOT, path.dirname(page)), target);
      assert.ok(fs.existsSync(base + '.wxml'), `${page} 引用的组件 ${name} 不存在：${target}`);
    }
  });
}

test('app.json：第 4 个 Tab 指向热点页，且 tabBar 4 项', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  assert.strictEqual(app.tabBar.list.length, 4);
  assert.strictEqual(app.tabBar.list[3].pagePath, 'pages/news/home/index');
  assert.strictEqual(app.tabBar.list[3].text, '热点');
  const custom = fs.readFileSync(path.join(ROOT, 'custom-tab-bar', 'index.js'), 'utf8');
  assert.ok(custom.includes('/pages/news/home/index'));
  assert.ok(custom.includes('热点'));
});
