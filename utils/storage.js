// utils/storage.js - 工时记录云存储封装（每条记录一个云文档）
const cloud = require('./cloud')

const COLLECTION = 'work_records'

function monthOf(dateStr) {
  return dateStr.slice(0, 7)
}

// 获取某月全部记录
async function getMonthRecords(monthStr) {
  const db = cloud.getDB()
  return cloud.fetchAll(db.collection(COLLECTION).where({ month: monthOf(monthStr) }))
}

// 新增记录
async function saveRecord(record) {
  const db = cloud.getDB()
  const data = Object.assign(cloud.stripSystemFields(record), { month: monthOf(record.date) })
  await db.collection(COLLECTION).add({ data })
}

// 修改记录（按自定义 id 定位文档）
async function updateRecord(record) {
  const doc = await cloud.findDocByCustomId(COLLECTION, record.id)
  if (!doc) throw new Error('记录不存在')
  const data = Object.assign(cloud.stripSystemFields(record), {
    month: monthOf(record.date),
    updatedAt: Date.now()
  })
  await cloud.getDB().collection(COLLECTION).doc(doc._id).update({ data })
}

// 删除记录
async function deleteRecord(id, dateStr) {
  const doc = await cloud.findDocByCustomId(COLLECTION, id)
  if (!doc) return
  await cloud.getDB().collection(COLLECTION).doc(doc._id).remove()
}

// 获取某年全部记录（年度汇总用）
async function getAllRecordsOfYear(year) {
  let all = []
  for (let m = 1; m <= 12; m++) {
    const ym = year + '-' + String(m).padStart(2, '0')
    const records = await getMonthRecords(ym)
    all = all.concat(records)
  }
  return all
}

module.exports = {
  getMonthRecords,
  saveRecord,
  updateRecord,
  deleteRecord,
  getAllRecordsOfYear
}
