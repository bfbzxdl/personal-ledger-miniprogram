// cloudfunctions/news/test/tags.test.js
// T-05 验收：R-14 惠民标签。
const test = require('node:test');
const assert = require('node:assert');

const { matchTags } = require('../lib/tags');
const { SEED } = require('../lib/seed');

const RULES = SEED.tagRules;

test('R-14 验收：标题含「公积金」的杭州条目打上「公积金」', () => {
  const tags = matchTags('杭州公积金新政：租房提取额度上调', '', RULES);
  assert.deepStrictEqual(tags, ['公积金']);
});

test('命中多个规则时按规则声明顺序返回', () => {
  const tags = matchTags('公积金贷款额度上调 同时发放购房补贴', '', RULES);
  assert.deepStrictEqual(tags, ['公积金', '住房', '补贴消费券']);
});

test('最多 MAX_TAGS 个，按规则顺序取前 N', () => {
  const tags = matchTags('社保 公积金 公租房 消费券 入学 医院 地铁 一网通办', '', RULES, 3);
  assert.strictEqual(tags.length, 3);
  assert.deepStrictEqual(tags, ['社保医保', '公积金', '住房']);
});

test('无命中返回空数组（前端不渲染占位）', () => {
  assert.deepStrictEqual(matchTags('杭州天气转晴', '', RULES), []);
});

test('摘要命中同样打标', () => {
  const tags = matchTags('杭州今日发布', '涉及医保参保缴费基数调整', RULES);
  assert.deepStrictEqual(tags, ['社保医保']);
});

test('8 类标签枚举与 SOURCES.yaml 一致', () => {
  assert.deepStrictEqual(
    RULES.map((r) => r.tag),
    ['社保医保', '公积金', '住房', '补贴消费券', '教育', '医疗', '交通出行', '政务办事']
  );
});

test('同一标签只返回一次', () => {
  const tags = matchTags('公积金 公积金 公积金', '', RULES);
  assert.deepStrictEqual(tags, ['公积金']);
});

test('D-15：扩充后的关键词能命中更多惠民表述', () => {
  assert.deepStrictEqual(matchTags('杭州老旧小区加装电梯提速', '', RULES), ['住房']);
  assert.deepStrictEqual(matchTags('杭州新增充电桩 5000 个', '', RULES), ['交通出行']);
  assert.deepStrictEqual(matchTags('养老金上调方案出炉', '', RULES), ['社保医保']);
  assert.deepStrictEqual(matchTags('灵活就业人员参保新政', '', RULES), ['社保医保']);
  assert.deepStrictEqual(matchTags('杭州推出托育补贴', '', RULES), ['补贴消费券', '教育']);
});

test('D-15：医保门诊条目同时命中社保医保与医疗（最多 3 个）', () => {
  const tags = matchTags('医保门诊报销比例提高', '', RULES);
  assert.deepStrictEqual(tags, ['社保医保', '医疗']);
  assert.ok(tags.length <= 3);
});

test('D-15：机关名不触发社保/医保标签（噪声治理）', () => {
  assert.deepStrictEqual(matchTags('市人力社保局党组理论学习中心组举行专题学习会', '', RULES), []);
  assert.deepStrictEqual(matchTags('杭州市人力资源和社会保障局发布季度劳动保障违法案例', '', RULES), []);
  // 真实惠民内容仍命中
  assert.deepStrictEqual(matchTags('社保服务进万家活动启动', '', RULES), ['社保医保']);
});
