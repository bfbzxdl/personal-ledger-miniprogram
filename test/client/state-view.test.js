// test/client/state-view.test.js
// T-13：统一空态/错误态组件（R-18）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'components', 'state-view');

let definition = null;
global.Component = (def) => {
  definition = def;
};
require('../../components/state-view/index.js');

test('声明 text / sub / actionText / plainActionText 四个属性', () => {
  assert.ok(definition);
  for (const key of ['text', 'sub', 'actionText', 'plainActionText']) {
    assert.ok(definition.properties[key], '缺少属性 ' + key);
  }
});

test('按钮点击分别抛 action / plainaction 事件', () => {
  const events = [];
  const ctx = {
    triggerEvent(name) {
      events.push(name);
    }
  };
  definition.methods.onAction.call(ctx);
  definition.methods.onPlain.call(ctx);
  assert.deepStrictEqual(events, ['action', 'plainaction']);
});

test('WXML 中 class 均有样式，且按文案条件渲染按钮', () => {
  const wxml = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(DIR, 'index.wxss'), 'utf8');
  const classes = new Set();
  const re = /class="([^"]*)"/g;
  let m;
  while ((m = re.exec(wxml))) {
    for (const token of m[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/)) {
      if (token && !token.endsWith('-')) classes.add(token);
    }
  }
  for (const c of classes) assert.ok(wxss.includes('.' + c), 'WXSS 缺少 .' + c);
  assert.ok(wxml.includes('wx:if="{{actionText}}"'), '主按钮按文案条件渲染');
  assert.ok(wxml.includes('wx:if="{{plainActionText}}"'), '次按钮按文案条件渲染');
  const json = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  assert.strictEqual(json.component, true);
});
