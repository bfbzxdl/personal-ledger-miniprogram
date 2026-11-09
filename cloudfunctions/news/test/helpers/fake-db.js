// cloudfunctions/news/test/helpers/fake-db.js
// 只实现云数据库被本项目用到的 API 子集（含 orderBy/skip/limit/remove 与 lt 比较），供纯逻辑单测使用。
function createFakeDB() {
  const store = new Map();
  let seq = 0;

  const command = {
    lt: (value) => ({ __op: 'lt', value }),
    lte: (value) => ({ __op: 'lte', value }),
    gt: (value) => ({ __op: 'gt', value }),
    gte: (value) => ({ __op: 'gte', value }),
    eq: (value) => ({ __op: 'eq', value }),
    neq: (value) => ({ __op: 'neq', value }),
    all: (values) => ({ __op: 'all', value: values }),
    in: (values) => ({ __op: 'in', value: values }),
    or: (conditions) => ({ __op: 'or', value: conditions }),
    and: (conditions) => ({ __op: 'and', value: conditions }),
    aggregate: { sum: (value) => ({ __agg: 'sum', value: value }) }
  };

  // 云数据库 db.RegExp({ regexp, options })
  function RegExpFactory(spec) {
    return { __op: 'regex', value: new RegExp(spec.regexp, spec.options || '') };
  }

  function bucket(name) {
    if (!store.has(name)) store.set(name, []);
    return store.get(name);
  }

  function comparable(v) {
    if (v instanceof Date) return v.getTime();
    return v;
  }

  function matchValue(actual, expected) {
    if (expected && typeof expected === 'object' && expected.__op) {
      const a = comparable(actual);
      const b = comparable(expected.value);
      switch (expected.__op) {
        case 'lt':
          return a < b;
        case 'lte':
          return a <= b;
        case 'gt':
          return a > b;
        case 'gte':
          return a >= b;
        case 'eq':
          return a === b;
        case 'neq':
          return a !== b;
        case 'all':
          return Array.isArray(actual) && expected.value.every((v) => actual.indexOf(v) !== -1);
        case 'in':
          return expected.value.map(comparable).indexOf(a) !== -1;
        case 'regex':
          return typeof actual === 'string' && expected.value.test(actual);
        default:
          return false;
      }
    }
    return actual === expected;
  }

  function matches(doc, cond) {
    if (!cond || typeof cond !== 'object') return false;
    if (cond.__op === 'and') return cond.value.every((c) => matches(doc, c));
    if (cond.__op === 'or') return cond.value.some((c) => matches(doc, c));
    return Object.keys(cond).every((k) => matchValue(doc[k], cond[k]));
  }

  function makeQuery(name, cond) {
    const state = { orders: [], skip: 0, limit: Infinity };
    const api = {
      orderBy(field, dir) {
        state.orders.push({ field, dir });
        return api;
      },
      skip(n) {
        state.skip = n;
        return api;
      },
      limit(n) {
        state.limit = n;
        return api;
      },
      async get() {
        let list = bucket(name).filter((d) => matches(d, cond));
        for (let i = state.orders.length - 1; i >= 0; i -= 1) {
          const { field, dir } = state.orders[i];
          list = list.slice().sort((a, b) => {
            const av = comparable(a[field]);
            const bv = comparable(b[field]);
            if (av === bv) return 0;
            return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
          });
        }
        return { data: list.slice(state.skip, state.skip + state.limit).map((d) => Object.assign({}, d)) };
      },
      async count() {
        return { total: bucket(name).filter((d) => matches(d, cond)).length };
      },
      async remove() {
        const list = bucket(name);
        let removed = 0;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (matches(list[i], cond)) {
            list.splice(i, 1);
            removed += 1;
          }
        }
        return { stats: { removed } };
      }
    };
    return api;
  }

  function aggregateOf(name) {
    const state = { cond: null, group: null, limit: Infinity };
    const api = {
      match(cond) {
        state.cond = cond;
        return api;
      },
      group(spec) {
        state.group = spec;
        return api;
      },
      limit(n) {
        state.limit = n;
        return api;
      },
      async end() {
        let list = bucket(name);
        if (state.cond) list = list.filter((d) => matches(d, state.cond));
        if (!state.group) return { list: list.slice(0, state.limit) };

        const field = String(state.group._id || '').replace(/^\$/, '');
        const grouped = new Map();
        for (const doc of list) {
          const key = doc[field];
          const row = grouped.get(key) || { _id: key };
          for (const [k, expr] of Object.entries(state.group)) {
            if (k === '_id') continue;
            if (expr && expr.__agg === 'sum') row[k] = (row[k] || 0) + Number(expr.value);
          }
          grouped.set(key, row);
        }
        return { list: Array.from(grouped.values()).slice(0, state.limit) };
      }
    };
    return api;
  }

  function collection(name) {
    return {
      where: (cond) => makeQuery(name, cond || {}),
      aggregate: () => aggregateOf(name),
      async add({ data }) {
        const _id = data._id || 'fake_' + ++seq;
        if (data._id && bucket(name).some((d) => d._id === _id)) {
          const err = new Error('duplicate _id: ' + _id);
          err.errCode = -502001;
          throw err;
        }
        bucket(name).push(Object.assign({ _id }, data));
        return { _id };
      },
      doc(id) {
        return {
          async get() {
            const hit = bucket(name).find((d) => d._id === id);
            if (!hit) throw new Error('document not exists');
            return { data: hit };
          },
          async update({ data }) {
            const hit = bucket(name).find((d) => d._id === id);
            if (!hit) throw new Error('document not exists');
            Object.assign(hit, data);
            return { stats: { updated: 1 } };
          },
          async set({ data }) {
            const list = bucket(name);
            const idx = list.findIndex((d) => d._id === id);
            const next = Object.assign({ _id: id }, data);
            if (idx >= 0) list[idx] = next;
            else list.push(next);
            return { stats: { updated: 1 } };
          },
          async remove() {
            const list = bucket(name);
            const idx = list.findIndex((d) => d._id === id);
            if (idx >= 0) list.splice(idx, 1);
            return { stats: { removed: idx >= 0 ? 1 : 0 } };
          }
        };
      },
      async get() {
        return { data: bucket(name).map((d) => Object.assign({}, d)) };
      },
      async count() {
        return { total: bucket(name).length };
      }
    };
  }

  return {
    command,
    RegExp: RegExpFactory,
    collection,
    async createCollection(name) {
      if (!store.has(name)) store.set(name, []);
      return { ok: true };
    },
    __dump: (name) => bucket(name).map((d) => Object.assign({}, d)),
    __size: (name) => bucket(name).length
  };
}

module.exports = { createFakeDB };
