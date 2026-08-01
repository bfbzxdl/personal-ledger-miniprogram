// 云函数：管理员数据管理（查看全部用户数据 / 清空集合）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// TODO: 替换为管理员自己的 OpenID（在管理页点“获取我的OpenID”后填入）
const ADMIN_OPENIDS = ['oWQbQ5J20dB-WT1r4iekx9Tco3vE']

async function fetchAll(baseQuery) {
  const countRes = await baseQuery.count()
  const batch = 100
  let all = []
  for (let skip = 0; skip < countRes.total; skip += batch) {
    const res = await baseQuery.skip(skip).limit(batch).get()
    all = all.concat(res.data)
  }
  return all
}

async function clearCollection(name) {
  let removed = 0
  while (true) {
    const res = await db.collection(name).limit(100).get()
    if (res.data.length === 0) break
    const ids = res.data.map(function (doc) { return doc._id })
    await db.collection(name).where({ _id: _.in(ids) }).remove()
    removed += res.data.length
    if (res.data.length < 100) break
  }
  return removed
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'stats'

  // 获取自己的 OpenID 不需要管理员权限
  if (action === 'whoami') {
    return { code: 0, data: { openid: OPENID } }
  }

  // 校验是否为管理员（任何人可调用，只返回布尔结果）
  if (action === 'check') {
    return { code: 0, data: { isAdmin: ADMIN_OPENIDS.indexOf(OPENID) !== -1 } }
  }

  if (ADMIN_OPENIDS.indexOf(OPENID) === -1) {
    return { code: 403, msg: '无权限，仅管理员可操作' }
  }

  if (action === 'stats') {
    const work = await db.collection('work_records').count()
    const ledger = await db.collection('ledger_records').count()
    return {
      code: 0,
      data: {
        workRecords: work.total,
        ledgerRecords: ledger.total
      }
    }
  }

  if (action === 'list') {
    const collectionName = event.collection
    if (collectionName !== 'work_records' && collectionName !== 'ledger_records') {
      return { code: 400, msg: '集合名称不合法' }
    }
    const where = {}
    if (event.openid) where._openid = event.openid
    const records = await fetchAll(db.collection(collectionName).where(where))
    const limit = Math.min(event.limit || 100, 1000)
    return { code: 0, data: records.slice(0, limit) }
  }

  if (action === 'clear') {
    const collectionName = event.collection
    if (collectionName !== 'work_records' && collectionName !== 'ledger_records') {
      return { code: 400, msg: '集合名称不合法' }
    }
    const removed = await clearCollection(collectionName)
    return { code: 0, data: { removed } }
  }

  return { code: 400, msg: '未知操作' }
}
