// test/client/news-card.test.js
// T-07：卡片组件结构与交互逻辑（无开发者工具时的静态/逻辑校验）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'components', 'news-card');

let definition = null;
global.Component = (def) => {
  definition = def;
};
require('../../components/news-card/index.js');

test('组件声明了 item / rank / showSummary 三个属性', () => {
  assert.ok(definition);
  assert.ok(definition.properties.item);
  assert.ok(definition.properties.rank);
  assert.ok(definition.properties.showSummary);
  assert.strictEqual(definition.properties.item.observer, 'onItemChange');
});

test('onItemChange 计算相对时间，切换条目时重置图片状态', () => {
  const ctx = {
    data: {},
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  definition.methods.onItemChange.call(ctx, { publishedAt: Date.now() - 60000 });
  assert.strictEqual(ctx.data.timeText, '1 分钟前');
  assert.strictEqual(ctx.data.coverOk, true);

  ctx.data.coverOk = false;
  definition.methods.onItemChange.call(ctx, { publishedAt: Date.now() - 5000 });
  assert.strictEqual(ctx.data.timeText, '刚刚');
  assert.strictEqual(ctx.data.coverOk, true, '换条目后应重试加载封面');
});

test('空 item 不报错，点击不触发事件', () => {
  const events = [];
  const ctx = {
    data: { item: null },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    triggerEvent(name, detail) {
      events.push({ name, detail });
    }
  };
  assert.doesNotThrow(() => definition.methods.onItemChange.call(ctx, null));
  assert.strictEqual(ctx.data.timeText, '');
  definition.methods.onTap.call(ctx);
  assert.strictEqual(events.length, 0);
});

test('点击卡片抛出 cardtap 事件并带 id', () => {
  const events = [];
  const ctx = {
    data: { item: { id: 'n1' } },
    triggerEvent(name, detail) {
      events.push({ name, detail });
    }
  };
  definition.methods.onTap.call(ctx);
  assert.deepStrictEqual(events[0], { name: 'cardtap', detail: { id: 'n1', item: { id: 'n1' } } });
});

test('图片加载失败后隐藏封面', () => {
  const ctx = {
    data: { coverOk: true },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  definition.methods.onImageError.call(ctx);
  assert.strictEqual(ctx.data.coverOk, false);
});

test('WXML 中使用的静态 class 都在 WXSS 中定义', () => {
  const wxml = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(DIR, 'index.wxss'), 'utf8');
  const classes = new Set();
  const re = /class="([^"]*)"/g;
  let m;
  while ((m = re.exec(wxml))) {
    // 去掉 {{...}} 表达式，只校验静态 class
    const staticPart = m[1].replace(/\{\{[^}]*\}\}/g, ' ');
    for (const token of staticPart.split(/\s+/)) {
      if (!token || token.endsWith('-')) continue;
      classes.add(token);
    }
  }
  assert.ok(classes.size > 0);
  for (const c of classes) {
    assert.ok(wxss.includes('.' + c), `WXSS 缺少 .${c}`);
  }
  // 动态类名同样必须有样式
  assert.ok(wxss.includes('.rank-top'), 'WXSS 缺少 .rank-top');
  for (const c of ['change-up', 'change-down', 'change-new']) {
    assert.ok(wxss.includes('.' + c), 'WXSS 缺少 .' + c);
  }
});

test('组件 json 声明 component:true', () => {
  const json = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  assert.strictEqual(json.component, true);
});
