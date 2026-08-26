// utils/cloud.js - 云开发数据库公共封装
let db = null

function getDB() {
  if (!wx.cloud) {
    throw new Error('当前微信版本不支持云开发')
  }
  if (!db) {
    db = wx.cloud.database()
  }
  return db
}

// 拉取查询的全部数据（小程序端单次最多返回20条，这里按页拉取，不再额外发 count）
async function fetchAll(baseQuery) {
  const batch = 20
  let all = []
  let skip = 0
  while (true) {
    const res = await baseQuery.skip(skip).limit(batch).get()
    all = all.concat(res.data)
    if (res.data.length < batch) break
    skip += batch
  }
  return all
}

// 按自定义 id 查找第一条记录
async function findDocByCustomId(collectionName, id) {
  const res = await getDB().collection(collectionName).where({ id }).limit(1).get()
  return (res.data && res.data[0]) || null
}

// 去掉云数据库系统字段，避免写入时被拒绝
function stripSystemFields(record) {
  const copy = Object.assign({}, record)
  delete copy._id
  delete copy._openid
  return copy
}

module.exports = { getDB, fetchAll, findDocByCustomId, stripSystemFields }
