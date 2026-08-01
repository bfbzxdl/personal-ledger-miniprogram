// utils/ledger-storage.js - 记账本云存储封装（每条记录一个云文档）
const cloud = require('./cloud')

const COLLECTION = 'ledger_records'

function monthOf(dateStr) {
  return dateStr.slice(0, 7)
}

// 获取某月记账记录
async function getLedgerMonthRecords(monthStr) {
  const db = cloud.getDB()
  return cloud.fetchAll(db.collection(COLLECTION).where({ month: monthOf(monthStr) }))
}

// 新增记录
async function saveLedgerRecord(record) {
  const db = cloud.getDB()
  const data = Object.assign(cloud.stripSystemFields(record), { month: monthOf(record.date) })
  await db.collection(COLLECTION).add({ data })
}

// 删除记录
async function deleteLedgerRecord(id, dateStr) {
  const doc = await cloud.findDocByCustomId(COLLECTION, id)
  if (!doc) return
  await cloud.getDB().collection(COLLECTION).doc(doc._id).remove()
}

// 获取某月记录 + 月度统计
async function getLedgerMonthData(monthStr) {
  const records = await getLedgerMonthRecords(monthStr)
  let income = 0
  let expense = 0
  records.forEach(function (r) {
    if (r.type === 'income') {
      income += r.amount
    } else {
      expense += r.amount
    }
  })
  income = Math.round(income * 100) / 100
  expense = Math.round(expense * 100) / 100
  return {
    records,
    summary: {
      income,
      expense,
      balance: Math.round((income - expense) * 100) / 100
    }
  }
}

// 兼容旧调用：计算月度统计
async function calcMonthSummary(monthStr) {
  const data = await getLedgerMonthData(monthStr)
  return data.summary
}

// 兼容旧调用：获取某月记录
async function getLedgerRecords(monthStr) {
  return getLedgerMonthRecords(monthStr)
}

module.exports = {
  getLedgerMonthRecords,
  saveLedgerRecord,
  deleteLedgerRecord,
  calcMonthSummary,
  getLedgerRecords,
  getLedgerMonthData
}
