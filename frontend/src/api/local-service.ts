import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  DispatchItemInput,
  DispatchItemResult,
  DispatchResourceSummary,
  DispatchResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const REPAIR_KEY = 'out_repair'
const DEFECT_KEY = 'defect'
const DETECT_KEY = 'pipe_detect'

const DISPATCHABLE_REPAIR_STATUSES = ['待派遣', '待重试']
const ACTIVE_REPAIR_STATUSES = ['已派遣', '维修中']
const TOOL_RETURN_STATUS = '待归还工具'

const DISPATCH_WORKERS = ['王伟', '李敏', '赵强', '陈静']
const TOOL_INVENTORY: Record<string, number> = {
  气体检测仪: 3,
  安全围挡: 5,
  高压疏通车: 2,
  管道封堵器: 1,
  抽水泵: 2,
  管道检测仪: 3,
}

type TimeRange = { start: Date; end: Date }

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function fieldText(value: string | number | boolean | undefined): string {
  return String(value ?? '').trim()
}

function parseToolNames(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join('、') : fieldText(value as string | number | boolean)
  return [...new Set(raw.split(/[、,，;；\s]+/).map((item) => item.trim()).filter(Boolean))]
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLocalDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`
}

function addHours(start: Date, hours: number): Date {
  return new Date(start.getTime() + hours * 60 * 60 * 1000)
}

function timeRangesOverlap(left: TimeRange, right: TimeRange): boolean {
  return left.start < right.end && right.start < left.end
}

function countToolDebts(detectRows: EntryRow[]): Record<string, number> {
  const debts: Record<string, number> = {}
  for (const row of detectRows.filter((item) => fieldText(item.status) === TOOL_RETURN_STATUS)) {
    for (const tool of parseToolNames(row['检测设备'])) {
      debts[tool] = (debts[tool] ?? 0) + 1
    }
  }
  return debts
}

export function dispatchResources(): DispatchResourceSummary {
  const debts = countToolDebts(listRows(DETECT_KEY))
  const toolAvailability = Object.fromEntries(
    Object.entries(TOOL_INVENTORY).map(([tool, stock]) => [tool, Math.max(0, stock - (debts[tool] ?? 0))]),
  )
  return {
    workers: [...DISPATCH_WORKERS],
    toolInventory: { ...TOOL_INVENTORY },
    toolAvailability,
  }
}

export function createBatchNo(): string {
  const now = new Date()
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
  return `DP-${date}-${String(now.getTime()).slice(-6)}`
}

export function confirmToolReturn(id: number): ActionResult {
  const rows = listRows(DETECT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的工具归还待办` }
  }
  if (fieldText(rows[index].status) !== TOOL_RETURN_STATUS) {
    return { ok: false, message: '该检测记录不是待归还工具待办' }
  }

  const returnedAt = formatLocalDateTime(new Date())
  rows[index] = {
    ...rows[index],
    status: '已完成',
    pending: false,
    abnormal: false,
    检测状态: '已完成',
    检测结果: `${fieldText(rows[index]['检测结果'])}；已于 ${returnedAt} 归还`,
  }
  saveRows(DETECT_KEY, rows)
  return { ok: true, message: '工具已确认归还，占用库存已释放' }
}

export function submitDispatchBatch(items: DispatchItemInput[]): DispatchResult {
  const batchNo = fieldText(items.find((item) => item.batchNo)?.batchNo) || createBatchNo()
  const repairs = listRows(REPAIR_KEY)
  const defects = listRows(DEFECT_KEY)
  let detectRows = listRows(DETECT_KEY)

  const resources = dispatchResources()
  const availability = { ...resources.toolAvailability }
  const schedule = new Map<string, TimeRange[]>()
  for (const worker of DISPATCH_WORKERS) {
    schedule.set(
      worker,
      repairs
        .filter((row) => fieldText(row['维修人员']) === worker && ACTIVE_REPAIR_STATUSES.includes(fieldText(row.status)))
        .flatMap((row) => {
          const start = new Date(fieldText(row['出发时间']))
          const hours = Number(row['预计工时'])
          if (Number.isNaN(start.getTime()) || !Number.isFinite(hours) || hours <= 0) {
            return []
          }
          return [{ start, end: addHours(start, hours) } satisfies TimeRange]
        }),
    )
  }

  const confirmed: DispatchItemResult[] = []
  const failed: DispatchItemResult[] = []
  const unassigned: DispatchItemResult[] = []
  let nextDetectId = detectRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)

  function saveRepair(row: EntryRow): void {
    const index = repairs.findIndex((item) => Number(item.id) === Number(row.id))
    if (index >= 0) {
      repairs[index] = row
      saveRows(REPAIR_KEY, repairs)
    }
  }

  function saveDefect(row: EntryRow): void {
    const index = defects.findIndex((item) => Number(item.id) === Number(row.id))
    if (index >= 0) {
      defects[index] = row
      saveRows(DEFECT_KEY, defects)
    }
  }

  function saveDetect(row: EntryRow): void {
    detectRows = [...detectRows, row]
    saveRows(DETECT_KEY, detectRows)
  }

  function markUnassigned(input: DispatchItemInput, repair: EntryRow): void {
    const reset: EntryRow = {
      ...repair,
      status: '待派遣',
      pending: true,
      abnormal: false,
      维修人员: '',
      返回时间: '',
      派出批次: '',
      派工失败原因: '',
      维修状态: '待派遣',
      预计工时: input.hours || repair['预计工时'],
      携带工具: input.tools.length ? input.tools.join('、') : repair['携带工具'],
      出发时间: input.startTime || repair['出发时间'],
    }
    saveRepair(reset)
    unassigned.push({
      id: Number(repair.id),
      dispatchNo: fieldText(repair['派遣编号']),
      ok: false,
      status: 'unassigned',
    })
  }

  function markRetry(input: DispatchItemInput, repair: EntryRow, reason: string): void {
    const updated: EntryRow = {
      ...repair,
      status: '待重试',
      pending: true,
      abnormal: true,
      维修人员: input.worker,
      预计工时: input.hours,
      携带工具: input.tools.join('、'),
      出发时间: input.startTime,
      返回时间: '',
      派出批次: batchNo,
      派工失败原因: reason,
      维修状态: '待重试',
    }
    saveRepair(updated)
    failed.push({
      id: Number(repair.id),
      dispatchNo: fieldText(repair['派遣编号']),
      ok: false,
      status: 'retry',
      reason,
      batchNo,
    })
  }

  function markConfirmed(repair: EntryRow, defect: EntryRow, range: TimeRange, tools: string[]): void {
    const dispatchNo = fieldText(repair['派遣编号'])
    const endText = formatLocalDateTime(range.end)

    saveRepair({
      ...repair,
      status: '维修中',
      pending: true,
      abnormal: false,
      维修人员: fieldText(repair['维修人员']),
      预计工时: Number(repair['预计工时']),
      携带工具: tools.join('、'),
      出发时间: fieldText(repair['出发时间']),
      返回时间: endText,
      派出批次: batchNo,
      派工失败原因: '',
      维修状态: '维修中',
    })

    saveDefect({
      ...defect,
      status: '维修中',
      pending: true,
      abnormal: false,
      关联派遣: dispatchNo,
      记录状态: '维修中',
    })

    const existingTodo = detectRows.find((row) => fieldText(row['关联派遣']) === dispatchNo)
    if (!existingTodo) {
      saveDetect({
        id: ++nextDetectId,
        status: TOOL_RETURN_STATUS,
        pending: true,
        abnormal: false,
        检测编号: `TOOL-RET-${String(nextDetectId).padStart(4, '0')}`,
        检测管段: `${fieldText(defect['所属管线'])}｜${fieldText(defect['缺陷类型'])}`,
        检测方式: '外出维修工具归还',
        检测设备: tools.join('、'),
        检测日期: range.end.toISOString().slice(0, 10),
        检测长度: '',
        检测结果: `工具归还待办：${dispatchNo}，维修人员 ${fieldText(repair['维修人员'])}，应还时间 ${endText}`,
        关联派遣: dispatchNo,
        检测状态: TOOL_RETURN_STATUS,
      })
    }

    confirmed.push({
      id: Number(repair.id),
      dispatchNo,
      ok: true,
      status: 'confirmed',
      batchNo,
    })
  }

  for (const input of items) {
    const repair = repairs.find((row) => Number(row.id) === Number(input.id))
    if (!repair) {
      failed.push({
        id: Number(input.id),
        dispatchNo: '',
        ok: false,
        status: 'retry',
        reason: '没有找到这条待派遣记录，请刷新后重试',
        batchNo,
      })
      continue
    }

    const dispatchNo = fieldText(repair['派遣编号'])
    const currentStatus = fieldText(repair.status)
    const existingBatch = fieldText(repair['派出批次'])

    if (existingBatch && existingBatch === batchNo && !DISPATCHABLE_REPAIR_STATUSES.includes(currentStatus)) {
      confirmed.push({ id: Number(repair.id), dispatchNo, ok: true, status: 'confirmed', batchNo })
      continue
    }

    if (!DISPATCHABLE_REPAIR_STATUSES.includes(currentStatus)) {
      const reason = `记录已是「${currentStatus}」，重复提交只保留首个派出批次「${existingBatch || '未知批次'}」`
      failed.push({ id: Number(repair.id), dispatchNo, ok: false, status: 'retry', reason, batchNo: existingBatch || batchNo })
      continue
    }

    const worker = fieldText(input.worker)
    if (!worker) {
      markUnassigned(input, repair)
      continue
    }
    if (!DISPATCH_WORKERS.includes(worker)) {
      markRetry(input, repair, `维修人员「${worker}」不在可派出人员名单中`)
      continue
    }

    const hours = Number(input.hours)
    const start = new Date(input.startTime)
    if (!input.startTime || Number.isNaN(start.getTime()) || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
      markRetry(input, repair, '出发时间或预计工时无效，预计工时需为 0 到 24 小时之间的数字')
      continue
    }

    const range = { start, end: addHours(start, hours) }
    const workerSchedule = schedule.get(worker) ?? []
    const collision = workerSchedule.find((item) => timeRangesOverlap(item, range))
    if (collision) {
      markRetry(
        input,
        repair,
        `${worker} 在 ${formatLocalDateTime(collision.start)} 至 ${formatLocalDateTime(collision.end)} 已有派工，时段不能重叠`,
      )
      continue
    }

    const defect = defects.find((row) => fieldText(row['缺陷编号']) === fieldText(repair['缺陷来源']))
    if (!defect) {
      markRetry(input, repair, `缺陷来源「${fieldText(repair['缺陷来源'])}」在缺陷记录中不存在`)
      continue
    }
    if (!['已确认', '维修中'].includes(fieldText(defect.status))) {
      markRetry(input, repair, `缺陷「${fieldText(defect['缺陷编号'])}」当前为「${fieldText(defect.status)}」，需先确认缺陷`)
      continue
    }

    const tools = parseToolNames(input.tools)
    const shortages = tools
      .map((tool) => ({
        tool,
        stock: TOOL_INVENTORY[tool] ?? 0,
        available: availability[tool] ?? (TOOL_INVENTORY[tool] ?? 0),
      }))
      .filter((item) => item.available <= 0)

    if (shortages.length > 0) {
      markRetry(
        input,
        repair,
        `工具不足：${shortages
          .map((item) => `「${item.tool}」库存 ${item.stock} 件，当前可借 0 件`)
          .join('；')}；请等待工具归还或调整工具需求`,
      )
      continue
    }

    for (const tool of tools) {
      availability[tool] = (availability[tool] ?? (TOOL_INVENTORY[tool] ?? 0)) - 1
    }
    workerSchedule.push(range)
    schedule.set(worker, workerSchedule)
    markConfirmed(
      { ...repair, 维修人员: worker, 预计工时: hours, 出发时间: input.startTime },
      defect,
      range,
      tools,
    )
  }

  const failedCount = failed.length + unassigned.length
  const message = failedCount === 0
    ? `派出批次 ${batchNo} 已确认 ${confirmed.length} 条派工，缺陷已转维修中，并已生成工具归还待办`
    : `批次 ${batchNo}：已确认 ${confirmed.length} 条，${failed.length} 条待重试，${unassigned.length} 条回到待派遣`

  return { ok: failed.length === 0 && unassigned.length === 0, message, batchNo, confirmed, failed, unassigned }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
