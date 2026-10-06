<template>
  <section class="page workbench-page" data-module="out_repair">
    <header class="page-head">
      <div>
        <h2>外出维修管理 / 新设派出工台</h2>
        <p class="page-desc">从待派遣记录批量选择后安排维修人员、预计工时、出发时段与工具需求；同一人员时段冲突或工具不足会保留成功结果并标出待重试项。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出外出维修清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="panel dispatch-panel">
      <div class="panel-head">
        <div>
          <h3>待派遣记录</h3>
          <p>勾选记录后在右侧调整派工信息；重复提交同一派出批次时，只保留首个已确认结果。</p>
        </div>
        <div class="batch-box">
          <span>当前派出批次</span>
          <strong>{{ batchNo }}</strong>
          <button class="btn ghost small" type="button" @click="resetBatch">重开批次</button>
        </div>
      </div>

      <div class="workbench-grid">
        <div class="candidate-wrap">
          <table class="data-table workbench-table">
            <thead>
              <tr>
                <th class="check-col">
                  <input
                    :checked="allSelected"
                    type="checkbox"
                    :aria-label="allSelected ? '取消全选' : '全选待派遣记录'"
                    @change="toggleAll"
                  />
                </th>
                <th>派遣编号</th>
                <th>缺陷来源</th>
                <th>需要工具</th>
                <th>当前状态</th>
                <th>默认工时</th>
                <th>上次失败原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in candidates" :key="String(row.id)" :class="{ selected: isSelected(row) }">
                <td><input v-model="selectedIds" type="checkbox" :value="Number(row.id)" /></td>
                <td>{{ row['派遣编号'] }}</td>
                <td>{{ row['缺陷来源'] }}</td>
                <td>{{ row['携带工具'] || '—' }}</td>
                <td>{{ row.status }}</td>
                <td>{{ row['预计工时'] }}</td>
                <td class="reason-cell">{{ row['派工失败原因'] || '—' }}</td>
              </tr>
              <tr v-if="!candidates.length">
                <td colspan="7" class="empty-state">暂无可派出记录，所有派工均已确认或返回</td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside class="schedule-card">
          <h3>逐条派工调整</h3>
          <div v-if="!drafts.length" class="draft-empty">请先勾选左侧待派遣记录</div>
          <div v-for="draft in drafts" :key="draft.id" class="draft-item">
            <div class="draft-title">
              <strong>{{ draft.dispatchNo }}</strong>
              <span>{{ draft.defectNo }}</span>
            </div>
            <label>
              <span>维修人员</span>
              <select v-model="draft.worker">
                <option value="">暂不选人</option>
                <option v-for="worker in resources.workers" :key="worker" :value="worker">{{ worker }}</option>
              </select>
            </label>
            <div class="draft-two-col">
              <label>
                <span>预计工时（小时）</span>
                <input v-model.number="draft.hours" min="0.5" max="24" step="0.5" type="number" />
              </label>
              <label>
                <span>出发时间</span>
                <input v-model="draft.startTime" type="datetime-local" />
              </label>
            </div>
            <fieldset>
              <legend>工具需求</legend>
              <label v-for="tool in selectableTools" :key="tool" class="tool-check">
                <input
                  :checked="draft.tools.includes(tool)"
                  type="checkbox"
                  :value="tool"
                  @change="toggleTool(draft, tool)"
                />
                <span>{{ tool }}</span>
                <em :class="{ short: resourceAvailability(tool) <= 0 }">
                  可借 {{ resourceAvailability(tool) }}/{{ resources.toolInventory[tool] }}
                </em>
              </label>
            </fieldset>
            <p v-if="draftWarning(draft)" class="draft-warning">{{ draftWarning(draft) }}</p>
          </div>

          <div class="worker-board">
            <h4>人员时段占用</h4>
            <p v-for="worker in resources.workers" :key="worker">
              <span>{{ worker }}</span>
              <small>{{ workerScheduleText(worker) }}</small>
            </p>
          </div>
        </aside>
      </div>

      <div class="submit-bar">
        <button class="btn primary" type="button" :disabled="submitting" @click="submitDrafts">
          {{ submitting ? '提交中...' : '一次提交派出安排' }}
        </button>
        <button class="btn ghost" type="button" :disabled="!selectedIds.length" @click="clearSelection">清空选择</button>
        <span class="submit-hint">未选人的记录不会派出，将回到「待派遣」</span>
      </div>

      <div v-if="lastResult" class="result-box" :class="{ partial: !lastResult.ok }">
        <strong>{{ lastResult.message }}</strong>
        <ul v-if="lastResult.failed.length">
          <li v-for="item in lastResult.failed" :key="`failed-${item.id}`">
            待重试：{{ item.dispatchNo || `#${item.id}` }} — {{ item.reason }}
          </li>
        </ul>
        <ul v-if="lastResult.unassigned.length">
          <li v-for="item in lastResult.unassigned" :key="`unassigned-${item.id}`">
            回到待派遣：{{ item.dispatchNo || `#${item.id}` }} — 未选择维修人员
          </li>
        </ul>
      </div>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="String(row.status) === '维修中'"
              class="link"
              type="button"
              @click="runAction('返回确认', row)"
            >
              返回确认
            </button>
            <span v-else class="muted-text">通过派出工台处理</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无外出维修数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条外出维修记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createBatchNo,
  dispatchResources,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  submitDispatchBatch,
} from '@/api/local-service'
import type {
  DispatchItemInput,
  DispatchResourceSummary,
  DispatchResult,
  EntryRow,
} from '@/data/types'

const meta = moduleMeta('out_repair')
const columns = ['派遣编号', '缺陷来源', '维修人员', '预计工时', '携带工具', '出发时间', '返回时间', '派出批次', '派工失败原因', '维修状态']
const statuses = ['待派遣', '已派遣', '维修中', '待重试', '已返回']

type Draft = {
  id: number
  dispatchNo: string
  defectNo: string
  worker: string
  hours: number
  startTime: string
  tools: string[]
  batchNo: string
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedIds = ref<number[]>([])
const drafts = ref<Draft[]>([])
const batchNo = ref(createBatchNo())
const submitting = ref(false)
const lastResult = ref<DispatchResult | null>(null)
const resources = ref<DispatchResourceSummary>(dispatchResources())

const selectableTools = computed(() => [
  ...new Set([
    ...Object.keys(resources.value.toolInventory),
    ...candidates.value.flatMap((row) => toolNames(row['携带工具'])),
  ]),
])
const candidates = computed(() =>
  rows.value.filter((row) => ['待派遣', '待重试'].includes(String(row.status))),
)
const allSelected = computed(
  () => candidates.value.length > 0 && candidates.value.every((row) => selectedIds.value.includes(Number(row.id))),
)
const stats = computed(() => [
  { label: '待派遣维修', value: rows.value.filter((row) => row.status === '待派遣').length },
  { label: '维修中数量', value: rows.value.filter((row) => row.status === '维修中').length },
  { label: '待重试派工', value: rows.value.filter((row) => row.status === '待重试').length },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function asText(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function toolNames(value: unknown): string[] {
  return String(value ?? '')
    .split(/[、,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function defaultStartTime(): string {
  const date = new Date()
  date.setMinutes(date.getMinutes() + 30, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function makeDraft(row: EntryRow): Draft {
  return {
    id: Number(row.id),
    dispatchNo: asText(row, '派遣编号'),
    defectNo: asText(row, '缺陷来源'),
    worker: asText(row, '维修人员'),
    hours: Number(row['预计工时']) || 2,
    startTime: asText(row, '出发时间') || defaultStartTime(),
    tools: toolNames(row['携带工具']).filter((tool) => selectableTools.value.includes(tool)),
    batchNo: asText(row, '派出批次') || batchNo.value,
  }
}

function syncDrafts() {
  for (const id of selectedIds.value) {
    const row = candidates.value.find((item) => Number(item.id) === id)
    if (row && !drafts.value.some((draft) => draft.id === id)) {
      drafts.value.push(makeDraft(row))
    }
  }
  drafts.value = drafts.value.filter((draft) => selectedIds.value.includes(draft.id))
}

function isSelected(row: EntryRow): boolean {
  return selectedIds.value.includes(Number(row.id))
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? candidates.value.map((row) => Number(row.id)) : []
  syncDrafts()
}

function clearSelection() {
  selectedIds.value = []
  drafts.value = []
}

function resetBatch() {
  batchNo.value = createBatchNo()
  for (const draft of drafts.value) {
    draft.batchNo = batchNo.value
  }
}

function toggleTool(draft: Draft, tool: string) {
  draft.tools = draft.tools.includes(tool)
    ? draft.tools.filter((item) => item !== tool)
    : [...draft.tools, tool]
}

function resourceAvailability(tool: string): number {
  const selectedUsage = drafts.value.reduce(
    (count, draft) => count + (draft.tools.includes(tool) ? 1 : 0),
    0,
  )
  return (resources.value.toolAvailability[tool] ?? 0) - selectedUsage
}

function draftWarning(draft: Draft): string {
  if (!draft.worker) {
    return '未选择维修人员，提交后该记录将回到待派遣。'
  }
  if (!draft.startTime || !Number.isFinite(draft.hours) || draft.hours <= 0) {
    return '请补全有效的出发时间和预计工时。'
  }
  const missing = draft.tools.filter((tool) => resourceAvailability(tool) < 0)
  if (missing.length) {
    return `当前批次内工具需求超过库存：${[...new Set(missing)].join('、')}。`
  }
  const collision = drafts.value.find((other) => {
    if (other.id === draft.id || other.worker !== draft.worker || !other.startTime) {
      return false
    }
    const start = new Date(draft.startTime).getTime()
    const otherStart = new Date(other.startTime).getTime()
    return start < otherStart + other.hours * 3600000 && otherStart < start + draft.hours * 3600000
  })
  if (collision) {
    return `与 ${collision.dispatchNo} 在同一维修人员时段内重叠。`
  }
  return ''
}

function activeRanges(worker: string): { start: Date; end: Date }[] {
  return rows.value
    .filter((row) => asText(row, '维修人员') === worker && ['已派遣', '维修中'].includes(String(row.status)))
    .map((row) => {
      const start = new Date(asText(row, '出发时间'))
      const hours = Number(row['预计工时'])
      return { start, end: new Date(start.getTime() + hours * 3600000) }
    })
    .filter((range) => !Number.isNaN(range.start.getTime()))
}

function workerScheduleText(worker: string): string {
  const existing = activeRanges(worker)
    .map((range) => `${range.start.toLocaleString('zh-CN', { hour12: false })} 起`)
    .join('；')
  const planned = drafts.value
    .filter((draft) => draft.worker === worker)
    .map((draft) => `${draft.dispatchNo} ${draft.startTime || '未定时'}`)
    .join('；')
  return [existing, planned].filter(Boolean).join('；') || '暂无占用'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

async function submitDrafts() {
  if (!drafts.value.length) {
    errorMessage.value = '请先选择至少一条待派遣记录'
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    const payload: DispatchItemInput[] = drafts.value.map((draft) => ({
      id: draft.id,
      worker: draft.worker,
      hours: draft.hours,
      startTime: draft.startTime,
      tools: draft.tools,
      batchNo: draft.batchNo || batchNo.value,
    }))
    const result = submitDispatchBatch(payload)
    lastResult.value = result
    batchNo.value = result.batchNo
    clearSelection()
    reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '派出安排提交失败'
  } finally {
    submitting.value = false
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    resources.value = dispatchResources()
    syncDrafts()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '外出维修列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 14px;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.panel-head h3,
.schedule-card h3,
.worker-board h4 {
  margin: 0 0 4px;
}
.panel-head p,
.schedule-card p {
  color: var(--muted);
  font-size: 12px;
  margin: 0;
}
.batch-box {
  display: grid;
  gap: 4px;
  justify-items: end;
  font-size: 12px;
  color: var(--muted);
}
.batch-box strong {
  color: #1f2937;
}
.btn.small {
  padding: 3px 8px;
  font-size: 12px;
}
.workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.65fr);
  gap: 14px;
  margin-top: 12px;
}
.workbench-table .check-col {
  width: 38px;
}
.workbench-table tr.selected {
  background: #eef6ff;
}
.reason-cell {
  color: #b42318;
  max-width: 220px;
}
.schedule-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: #fbfdff;
  max-height: 620px;
  overflow: auto;
}
.draft-empty {
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  color: var(--muted);
  margin-top: 10px;
}
.draft-item {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 8px;
  padding: 10px;
  margin-top: 10px;
}
.draft-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
}
.draft-title span {
  color: var(--muted);
}
.draft-item label,
.draft-two-col {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--muted);
}
.draft-two-col {
  grid-template-columns: 1fr 1fr;
}
.draft-item select,
.draft-item input {
  width: 100%;
}
.draft-item fieldset {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin: 10px 0 0;
  padding: 8px;
}
.draft-item legend {
  color: var(--muted);
  font-size: 12px;
  padding: 0 4px;
}
.tool-check {
  display: grid !important;
  grid-template-columns: auto 1fr auto;
  gap: 6px !important;
  align-items: center;
  color: #1f2937 !important;
  margin-bottom: 4px;
}
.tool-check em {
  font-style: normal;
  color: var(--muted);
}
.tool-check em.short {
  color: #b42318;
  font-weight: 600;
}
.draft-warning {
  color: #b42318;
  font-size: 12px;
  margin: 8px 0 0;
}
.worker-board {
  margin-top: 14px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.worker-board p {
  display: grid;
  gap: 2px;
  margin: 8px 0 0;
}
.worker-board small {
  color: var(--muted);
  line-height: 1.4;
}
.submit-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.submit-hint {
  color: var(--muted);
  font-size: 12px;
}
.result-box {
  margin-top: 12px;
  border: 1px solid #93c5fd;
  background: #eff6ff;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}
.result-box.partial {
  border-color: #fecaca;
  background: #fff7ed;
}
.result-box ul {
  margin: 8px 0 0 18px;
  padding: 0;
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 1100px) {
  .workbench-grid {
    grid-template-columns: 1fr;
  }
}
</style>
