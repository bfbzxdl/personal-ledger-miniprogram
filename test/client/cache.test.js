// test/client/cache.test.js
// T-07：前端缓存 TTL 行为（docs/API.md §6）。
const test = require('node:test');
const assert = require('node:assert');

const store = new Map();
global.wx = {
  getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k, v) => store.set(k, v),
  removeStorageSync: (k) => store.delete(k),
  getStorageInfoSync: () => ({ keys: Array.from(store.keys()) })
};

const cache = require('../../utils/cache');

test('写后读命中，且带 TTL 时间戳', () => {
  store.clear();
  cache.write('list:today:all:all:1', { items: [1, 2] }, 1000);
  assert.deepStrictEqual(cache.read('list:today:all:all:1', 5000, 2000), { items: [1, 2] });
  assert.strictEqual(store.get('news:list:today:all:all:1').t, 1000);
});

test('超过 TTL 返回 null 并清除该键', () => {
  store.clear();
  cache.write('k', { a: 1 }, 1000);
  assert.strictEqual(cache.read('k', 1000, 3000), null);
  assert.strictEqual(store.has('news:k'), false);
});

test('损坏数据返回 null', () => {
  store.clear();
  store.set('news:bad', 'not-an-object');
  assert.strictEqual(cache.read('bad', 5000, 1000), null);
});

test('remove 与 clearAll 只清理 news: 前缀', () => {
  store.clear();
  cache.write('a', 1, 1000);
  cache.write('b', 2, 1000);
  store.set('other:key', 'keep');
  cache.remove('a');
  assert.strictEqual(store.has('news:a'), false);
  cache.clearAll();
  assert.strictEqual(store.has('news:b'), false);
  assert.strictEqual(store.get('other:key'), 'keep');
});

test('wx 存储抛错时读写都不崩', () => {
  const original = global.wx.setStorageSync;
  global.wx.setStorageSync = () => {
    throw new Error('quota exceeded');
  };
  assert.doesNotThrow(() => cache.write('x', 1));
  global.wx.setStorageSync = original;
});
