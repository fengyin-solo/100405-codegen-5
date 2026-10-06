import type { DispatchState, ToolItem } from './dispatch-types'

// 可派出的维修班组：工台里从这份名单挑人，技能仅作提示，不限制排单。
export const REPAIR_CREW: { name: string; skill: string }[] = [
  { name: '张伟', skill: '给排水抢修' },
  { name: '李娜', skill: '管道检测' },
  { name: '王强', skill: '电焊作业' },
  { name: '赵敏', skill: '开挖修复' },
  { name: '陈杰', skill: '泵站机电' },
  { name: '刘洋', skill: '管道封堵' },
]

// 工具台账：名称即唯一键，stock 为在册总数；可借数量 = 在册数 - 尚未归还的借出数。
export const TOOL_CATALOG: { name: string; stock: number }[] = [
  { name: '管道潜望镜', stock: 2 },
  { name: '气体检测仪', stock: 3 },
  { name: '管道封堵器', stock: 2 },
  { name: '抽水泵', stock: 2 },
  { name: '电焊机', stock: 1 },
  { name: '切割机', stock: 2 },
  { name: '发电机', stock: 2 },
  { name: '安全围挡', stock: 4 },
  { name: '液压破碎钳', stock: 1 },
  { name: 'CCTV检测爬行器', stock: 1 },
]

/** 结构化工具需求与记录里「携带工具」文本（工具名:数量，多个用逗号/顿号分隔）互转。 */
export function encodeTools(tools: ToolItem[]): string {
  return tools
    .filter((item) => item.name.trim() !== '' && item.qty > 0)
    .map((item) => `${item.name}:${item.qty}`)
    .join('，')
}

export function decodeTools(text: unknown): ToolItem[] {
  const raw = String(text ?? '').trim()
  if (raw === '') {
    return []
  }
  const result: ToolItem[] = []
  for (const part of raw.split(/[,，、;；]/)) {
    const token = part.trim()
    if (token === '') {
      continue
    }
    const match = token.match(/^(.*?)[:：xX×]\s*(\d+)\s*$/)
    const name = match ? match[1].trim() : token
    const qty = match ? Number(match[2]) : 1
    if (name === '') {
      continue
    }
    const existing = result.find((item) => item.name === name)
    if (existing) {
      existing.qty += qty
    } else {
      result.push({ name, qty: qty > 0 ? qty : 1 })
    }
  }
  return result
}

// 首次打开工台时，给已派出的样例挂两条工具归还待办，管道检测页一进来就能看到。
export function initialDispatchState(): DispatchState {
  const today = new Date()
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`
  return {
    seq: 2,
    batches: [
      {
        batchNo: `PC-${stamp.replace(/-/g, '')}-01`,
        key: 'seed-batch-0006',
        createdAt: `${stamp} 08:30`,
        repairIds: [6, 7],
      },    ],
    todos: [
      {
        id: 1,
        repairId: 6,
        dispatchNo: 'WX-20261006-006',
        batchNo: `PC-${stamp.replace(/-/g, '')}-01`,
        worker: '王强',
        tools: [
          { name: '电焊机', qty: 1 },
          { name: '安全围挡', qty: 2 },
        ],
        plannedReturn: `${stamp} 16:00`,
        returned: false,
        createdAt: `${stamp} 08:30`,
      },
      {
        id: 2,
        repairId: 7,
        dispatchNo: 'WX-20261006-007',
        batchNo: `PC-${stamp.replace(/-/g, '')}-01`,
        worker: '赵敏',
        tools: [
          { name: '液压破碎钳', qty: 1 },
          { name: '抽水泵', qty: 1 },
          { name: '安全围挡', qty: 2 },
        ],
        plannedReturn: `${stamp} 17:00`,
        returned: false,
        createdAt: `${stamp} 08:30`,
      },
    ],
  }
}
