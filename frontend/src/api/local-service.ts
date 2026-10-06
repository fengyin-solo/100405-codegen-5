import { MODULE_BY_KEY } from '@/data/modules'
import { decodeTools, encodeTools, TOOL_CATALOG } from '@/data/dispatch'
import { dispatchState, resetDispatchState, saveDispatchState } from '@/data/dispatch-store'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'
import type {
  DispatchDraftItem,
  DispatchOutcome,
  DispatchPreviewItem,
  ToolItem,
} from '@/data/dispatch-types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

export function resetModule(key: string): PageResult {
  resetRows(key)
  if (key === 'out_repair') {
    // 派出批次和工具待办跟着外出维修一起回到样例，避免对不上号。
    resetDispatchState()
  }
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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

/* ------------------------------------------------------------------ */
/* 外出维修新设派出工台：排人排时排工具、缺陷联动、工具归还待办都在这里 */
/* ------------------------------------------------------------------ */

type Interval = { start: number; end: number }

function toMinutes(value: string): number | null {
  // 兼容 datetime-local（YYYY-MM-DDTHH:mm）与记录里的「YYYY-MM-DD HH:mm」。
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!match) {
    return null
  }
  const [, year, month, day, hour, minute] = match
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime()
}

function toDisplayTime(value: string): string {
  return String(value ?? '').trim().replace('T', ' ')
}

function overlap(a: Interval, b: Interval): boolean {
  // 半开区间：上一条刚收工，下一条同一时刻出发不算撞档。
  return a.start < b.end && b.start < a.end
}

// 已经派出/维修中的记录都占着维修人员的时段，返回确认后的不再占用。
function workerBusy(
  rows: EntryRow[],
  worker: string,
  interval: Interval,
  ignoreRepairId?: number,
): string | null {
  for (const row of rows) {
    if (Number(row.id) === ignoreRepairId) {
      continue
    }
    if (row.status !== '已派遣' && row.status !== '维修中') {
      continue
    }
    if (String(row.维修人员 ?? '').trim() !== worker) {
      continue
    }
    const start = toMinutes(String(row.出发时间 ?? ''))
    const hours = Number(row.预计工时)
    if (start === null || !Number.isFinite(hours) || hours <= 0) {
      continue
    }
    const existing = { start, end: start + hours * 60 * 60 * 1000 }
    if (overlap(existing, interval)) {
      return String(row.派遣编号 ?? row.id)
    }
  }
  return null
}

function aggregateTools(items: { tools: ToolItem[] }[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const item of items) {
    for (const tool of item.tools) {
      if (tool.name.trim() !== '' && tool.qty > 0) {
        totals.set(tool.name, (totals.get(tool.name) ?? 0) + tool.qty)
      }
    }
  }
  return totals
}

// 尚未归还的工具占用着库存；同一批内的需求在 planBatch 里顺序扣减。
function borrowedTools(): Map<string, number> {
  const borrowed = new Map<string, number>()
  for (const todo of dispatchState().todos) {
    if (todo.returned) {
      continue
    }
    for (const tool of todo.tools) {
      borrowed.set(tool.name, (borrowed.get(tool.name) ?? 0) + tool.qty)
    }
  }
  return borrowed
}

export type ToolAvailability = { name: string; stock: number; borrowed: number; available: number }

export function listToolAvailability(): ToolAvailability[] {
  const borrowed = borrowedTools()
  return TOOL_CATALOG.map((tool) => {
    const used = borrowed.get(tool.name) ?? 0
    return { name: tool.name, stock: tool.stock, borrowed: used, available: tool.stock - used }
  })
}

type PlannedItem = {
  item: DispatchDraftItem
  repair: EntryRow | undefined
  unassigned: boolean
  error?: string
}

/** 预演与正式提交共用同一套判定：库存顺序扣减，同人时段先存量后本批。 */
function planBatch(items: DispatchDraftItem[]): PlannedItem[] {
  const repairRows = listRows('out_repair')
  const remaining = new Map<string, number>()
  for (const tool of listToolAvailability()) {
    remaining.set(tool.name, tool.available)
  }
  // 本批内已确认占用的人员时段。
  const claimedByWorker = new Map<string, Interval[]>()
  const planned: PlannedItem[] = []

  for (const item of items) {
    const repair = repairRows.find((row) => Number(row.id) === item.repairId)
    const worker = item.worker.trim()
    if (worker === '') {
      planned.push({ item, repair, unassigned: true })
      continue
    }
    if (!repair) {
      planned.push({ item, repair, unassigned: false, error: '派遣记录不存在或已被处理' })
      continue
    }
    if (repair.status !== '待派遣') {
      planned.push({ item, repair, unassigned: false, error: `记录当前为「${repair.status}」，不能重复派出` })
      continue
    }
    const start = toMinutes(item.startTime)
    if (start === null) {
      planned.push({ item, repair, unassigned: false, error: '请选择计划出发时间' })
      continue
    }
    if (!Number.isFinite(item.hours) || item.hours <= 0) {
      planned.push({ item, repair, unassigned: false, error: '预计工时需为大于 0 的数字' })
      continue
    }
    const interval = { start, end: start + item.hours * 60 * 60 * 1000 }
    const busyWith = workerBusy(repairRows, worker, interval, item.repairId)
    if (busyWith) {
      planned.push({ item, repair, unassigned: false, error: `与${worker}已派出的「${busyWith}」时段重叠` })
      continue
    }
    const claimed = claimedByWorker.get(worker) ?? []
    if (claimed.some((slot) => overlap(slot, interval))) {
      planned.push({ item, repair, unassigned: false, error: `与本批内${worker}的另一条派出时段重叠` })
      continue
    }
    const cleanTools = item.tools.filter((tool) => tool.name.trim() !== '' && tool.qty > 0)
    const shortages: string[] = []
    for (const tool of cleanTools) {
      const left = remaining.get(tool.name)
      if (left === undefined) {
        shortages.push(`${tool.name}不在工具台账`)
      } else if (left < tool.qty) {
        shortages.push(`${tool.name}需${tool.qty}件，可借仅${Math.max(left, 0)}件，缺${tool.qty - Math.max(left, 0)}件`)
      }
    }
    if (shortages.length > 0) {
      planned.push({ item, repair, unassigned: false, error: `工具不足：${shortages.join('；')}` })
      continue
    }
    for (const tool of cleanTools) {
      remaining.set(tool.name, (remaining.get(tool.name) ?? 0) - tool.qty)
    }
    claimed.push(interval)
    claimedByWorker.set(worker, claimed)
    planned.push({ item: { ...item, worker, tools: cleanTools }, repair, unassigned: false })
  }
  return planned
}

/** 工台实时预演：不落库，只回每条记录能不能派出、原因是什么。 */
export function previewDispatch(items: DispatchDraftItem[]): DispatchPreviewItem[] {
  return planBatch(items).map((entry) => {
    if (entry.unassigned) {
      return { repairId: entry.item.repairId, level: 'unassigned', reason: '未选人，提交后回到待派遣' }
    }
    if (entry.error) {
      return { repairId: entry.item.repairId, level: 'error', reason: entry.error }
    }
    return { repairId: entry.item.repairId, level: 'ok' }
  })
}

function nextBatchNo(state: ReturnType<typeof dispatchState>): string {
  const now = new Date()
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}`
  const prefix = `PC-${day}-`
  const used = state.batches
    .filter((batch) => batch.batchNo.startsWith(prefix))
    .map((batch) => Number(batch.batchNo.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
  const seq = (used.length ? Math.max(...used) : 0) + 1
  return `${prefix}${String(seq).padStart(2, '0')}`
}

/**
 * 一次提交一批派出安排：
 * - 幂等：同一 idempotencyKey 只认首个批次，重复提交直接返回，不动数据；
 * - 成功的逐条落库并联动缺陷「维修中」、登记工具归还待办；
 * - 派工失败（撞档/工具不足等）保留在待派遣并返回失败原因，未选人的同样留在待派遣。
 */
export function submitDispatch(items: DispatchDraftItem[], idempotencyKey: string): DispatchOutcome {
  const state = dispatchState()
  const key = idempotencyKey.trim()
  if (key !== '' && state.batches.some((batch) => batch.key === key)) {
    return { duplicate: true, message: '该派出批次已提交，重复提交只保留首个批次，未重复派工。' }
  }

  const planned = planBatch(items)
  const confirmedPlans = planned.filter((entry) => !entry.unassigned && !entry.error && entry.repair)
  if (confirmedPlans.length === 0) {
    return {
      duplicate: false,
      batchNo: null,
      confirmed: [],
      failed: planned
        .filter((entry) => !entry.unassigned)
        .map((entry) => ({ repairId: entry.item.repairId, ok: false, reason: entry.error })),
      unassigned: planned.filter((entry) => entry.unassigned).map((entry) => entry.item.repairId),
    }
  }

  const batchNo = nextBatchNo(state)
  const now = new Date()
  const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const repairRows = listRows('out_repair')
  const confirmedIds: number[] = []
  let todoSeq = state.seq
  const todos = [...state.todos]

  for (const entry of confirmedPlans) {
    const repair = entry.repair as EntryRow
    const start = toMinutes(entry.item.startTime) as number
    const end = new Date(start + entry.item.hours * 60 * 60 * 1000)
    const plannedReturn = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(
      end.getDate(),
    ).padStart(2, '0')} ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
    const index = repairRows.findIndex((row) => Number(row.id) === repair.id)
    repairRows[index] = {
      ...repairRows[index],
      status: '已派遣',
      pending: true,
      abnormal: false,
      批次编号: batchNo,
      维修人员: entry.item.worker,
      预计工时: String(entry.item.hours),
      携带工具: encodeTools(entry.item.tools),
      出发时间: toDisplayTime(entry.item.startTime),
      维修状态: '已派遣',
    }
    confirmedIds.push(Number(repair.id))
    todoSeq += 1
    todos.push({
      id: todoSeq,
      repairId: Number(repair.id),
      dispatchNo: String(repair.派遣编号),
      batchNo,
      worker: entry.item.worker,
      tools: entry.item.tools.map((tool) => ({ ...tool })),
      plannedReturn,
      returned: false,
      createdAt,
    })
  }
  saveRows('out_repair', repairRows)

  // 派出成功的记录联动缺陷记录页：对应缺陷进入「维修中」（已闭环的缺陷不回退）。
  const defectRows = listRows('defect')
  const openDefects = new Set(['待确认', '已确认'])
  let defectChanged = false
  for (const entry of confirmedPlans) {
    const source = String((entry.repair as EntryRow).缺陷来源 ?? '').trim()
    if (source === '') {
      continue
    }
    for (let i = 0; i < defectRows.length; i += 1) {
      const defect = defectRows[i]
      if (String(defect.缺陷编号 ?? '') !== source) {
        continue
      }
      if (openDefects.has(String(defect.status))) {
        defectRows[i] = { ...defect, status: '维修中', pending: true, abnormal: false, 记录状态: '维修中' }
        defectChanged = true
      }
    }
  }
  if (defectChanged) {
    saveRows('defect', defectRows)
  }

  const nextState = {
    ...state,
    seq: todoSeq,
    batches:
      key === ''
        ? state.batches
        : [...state.batches, { batchNo, key, createdAt, repairIds: confirmedIds }],
    todos,
  }
  saveDispatchState(nextState)

  return {
    duplicate: false,
    batchNo,
    confirmed: confirmedPlans.map((entry) => ({ repairId: entry.item.repairId, ok: true })),
    failed: planned
      .filter((entry) => !entry.unassigned && entry.error)
      .map((entry) => ({ repairId: entry.item.repairId, ok: false, reason: entry.error })),
    unassigned: planned.filter((entry) => entry.unassigned).map((entry) => entry.item.repairId),
  }
}

/** 管道检测页读取工具归还待办（默认只看未归还）。 */
export function listReturnTodos(includeReturned = false) {
  const todos = dispatchState().todos
  return includeReturned ? todos : todos.filter((todo) => !todo.returned)
}

export function confirmToolReturn(todoId: number): ActionResult {
  const state = dispatchState()
  const index = state.todos.findIndex((todo) => todo.id === todoId)
  if (index < 0) {
    return { ok: false, message: '没有找到这条工具归还待办' }
  }
  if (state.todos[index].returned) {
    return { ok: false, message: '该批次工具已归还，不用重复确认' }
  }
  const todos = [...state.todos]
  todos[index] = { ...todos[index], returned: true }
  saveDispatchState({ ...state, todos })
  return { ok: true, message: `「${state.todos[index].dispatchNo}」借出的工具已确认归还入库` }
}
