/** 外出维修新设派出工台相关类型：派工草稿、校验结果、工具归还待办。 */

export type ToolItem = {
  name: string
  qty: number
}

/** 工台里逐条调整的一条派工安排。worker 为空表示这条暂不派人。 */
export type DispatchDraftItem = {
  repairId: number
  worker: string
  startTime: string // datetime-local：YYYY-MM-DDTHH:mm
  hours: number
  tools: ToolItem[]
}

export type DispatchItemResult = {
  repairId: number
  ok: boolean
  reason?: string
}

/** 一次批量派出的整体结果：成功的逐条落库，失败/未选人保留在待派遣。 */
export type DispatchOutcome =
  | { duplicate: true; message: string }
  | {
      duplicate: false
      batchNo: string | null
      confirmed: DispatchItemResult[]
      failed: DispatchItemResult[]
      unassigned: number[]
    }

/** 工台实时预演结果：ok 通过；unassigned 未选人（提交后回待派遣）；error 派工失败。 */
export type DispatchPreviewItem = {
  repairId: number
  level: 'ok' | 'unassigned' | 'error'
  reason?: string
}

export type DispatchBatch = {
  batchNo: string
  key: string // 幂等键：同一键只登记首个派出批次
  createdAt: string
  repairIds: number[]
}

/** 派出后挂到管道检测页的工具归还待办。 */
export type ReturnTodo = {
  id: number
  repairId: number
  dispatchNo: string
  batchNo: string
  worker: string
  tools: ToolItem[]
  plannedReturn: string // YYYY-MM-DD HH:mm
  returned: boolean
  createdAt: string
}

export type DispatchState = {
  seq: number
  batches: DispatchBatch[]
  todos: ReturnTodo[]
}
