// cloudfunctions/news/lib/time.js
// 时区换算与自然日工具：全部按 Asia/Shanghai（REQ §1 TZ / TZ_OFFSET_MIN）。
const { C } = require('./const');

const DAY_MS = 86400000;

/** 毫秒时间戳 → Asia/Shanghai 的自然日 YYYY-MM-DD */
function dayOf(ms) {
  const t = ms === undefined || ms === null ? Date.now() : ms;
  return new Date(t + C.TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/** Asia/Shanghai 某日 00:00:00 的毫秒时间戳 */
function startOfDay(day) {
  return Date.parse(day + 'T00:00:00+08:00');
}

/** 某日 23:59:59.999 的毫秒时间戳 */
function endOfDay(day) {
  return startOfDay(day) + DAY_MS - 1;
}

/** 相差小时数（b - a） */
function hoursBetween(a, b) {
  return (b - a) / 3600000;
}

/** 距今小时数，负数按 0（REQ R-06） */
function ageHours(ms, now) {
  const t = now === undefined ? Date.now() : now;
  const h = (t - ms) / 3600000;
  return h > 0 ? h : 0;
}

/** 是否早于「今天」（用于 stale 判定） */
function isBeforeToday(ms, now) {
  if (!ms) return false;
  return dayOf(ms) < dayOf(now);
}

module.exports = { DAY_MS, dayOf, startOfDay, endOfDay, hoursBetween, ageHours, isBeforeToday };
