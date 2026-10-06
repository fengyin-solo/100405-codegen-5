/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type DispatchItemInput = {
  id: number
  worker: string
  hours: number
  startTime: string
  tools: string[]
  batchNo?: string
}

export type DispatchItemResult = {
  id: number
  dispatchNo: string
  ok: boolean
  status: 'confirmed' | 'retry' | 'unassigned'
  reason?: string
  batchNo?: string
}

export type DispatchResult = {
  ok: boolean
  message: string
  batchNo: string
  confirmed: DispatchItemResult[]
  failed: DispatchItemResult[]
  unassigned: DispatchItemResult[]
}

export type DispatchResourceSummary = {
  workers: string[]
  toolInventory: Record<string, number>
  toolAvailability: Record<string, number>
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
