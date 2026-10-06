<template>
  <section class="page" data-module="out_repair">
    <header class="page-head">
      <div>
        <h2>外出维修管理</h2>
        <p class="page-desc">从待派遣记录勾选一组，在派出工台里逐条安排维修人员、出发时段、预计工时与携带工具；同人不排重叠时段，工具库存不足会标明缺口。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="selectedIds.size === 0" @click="openBench">
          派出工台（已选 {{ selectedIds.size }} 条）
        </button>
        <button class="btn" type="button" @click="exportRows">导出外出维修清单</button>
        <button class="btn ghost" type="button" @click="openCreate">登记外出维修</button>
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
          <th class="check-col">选择</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-selected': selectedIds.has(Number(row.id)) }">
          <td class="check-col">
            <input
              v-if="row.status === '待派遣'"
              type="checkbox"
              :checked="selectedIds.has(Number(row.id))"
              @change="toggleSelect(Number(row.id))"
            />
            <span v-else class="check-disabled">—</span>
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无外出维修数据，可先登记外出维修</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条外出维修记录（仅「待派遣」可勾选进派出工台）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 新设派出工台 -->
    <div v-if="benchOpen" class="modal-mask" @click.self="closeBench">
      <div class="modal bench-modal">
        <header class="modal-head">
          <div>
            <h3>派出工台 · 批量安排出工</h3>
            <p class="modal-sub">
              本批 {{ drafts.length }} 条待派遣记录，可逐条调整；不允许把同一维修人员排到重叠时段。
              不选人的记录提交后回到待派遣。
            </p>
          </div>
          <button class="btn ghost" type="button" @click="closeBench">关闭</button>
        </header>

        <div class="tool-strip">
          <span class="tool-strip-title">工具可借库存：</span>
          <span
            v-for="tool in getToolAvailability()"
            :key="tool.name"
            class="tool-chip"
            :class="{ 'tool-low': tool.available <= 0 }"
          >
            {{ tool.name }} {{ tool.available }}/{{ tool.stock }}
          </span>
        </div>

        <div v-if="duplicateMessage" class="bench-banner warn">{{ duplicateMessage }}</div>
        <div v-if="submitSummary" class="bench-banner" :class="submitSummary.tone">
          {{ submitSummary.text }}
        </div>

        <div class="bench-list">
          <article
            v-for="draft in drafts"
            :key="draft.repairId"
            class="bench-card"
            :class="draft.state === 'confirmed' ? 'is-confirmed' : ''"
          >
            <div class="bench-card-head">
              <div>
                <strong>{{ draft.dispatchNo }}</strong>
                <span class="bench-source">缺陷来源：{{ draft.source || '未关联缺陷' }}</span>
              </div>
              <span v-if="hintMap.get(draft.repairId)" class="bench-hint" :class="hintMap.get(draft.repairId)!.level">
                {{ hintMap.get(draft.repairId)!.reason }}
              </span>
              <span v-else-if="draft.state === 'confirmed'" class="bench-hint ok">
                已派出 · 批次 {{ confirmedBatch }}
              </span>
            </div>

            <fieldset class="bench-fields" :disabled="draft.state === 'confirmed'">
              <label class="bench-field">
                <span>维修人员</span>
                <select v-model="draft.worker">
                  <option value="">暂不派人（回待派遣）</option>
                  <option v-for="member in crew" :key="member.name" :value="member.name">
                    {{ member.name }}（{{ member.skill }}）
                  </option>
                </select>
              </label>
              <label class="bench-field">
                <span>出发时间</span>
                <input v-model="draft.startTime" type="datetime-local" />
              </label>
              <label class="bench-field bench-hours">
                <span>预计工时（小时）</span>
                <input v-model.number="draft.hours" type="number" min="0.5" step="0.5" />
              </label>
              <div class="bench-field bench-tools">
                <span>携带工具</span>
                <div class="tool-editor">
                  <span v-for="tool in draft.tools" :key="tool.name" class="tool-pick">
                    {{ tool.name }} × {{ tool.qty }}
                    <button type="button" class="link" @click="removeTool(draft, tool.name)">移除</button>
                  </span>
                  <span v-if="draft.tools.length === 0" class="tool-empty">不带工具</span>
                  <span class="tool-add">
                    <select v-model="draft.pickerName">
                      <option value="">选择工具</option>
                      <option v-for="tool in catalog" :key="tool.name" :value="tool.name">{{ tool.name }}</option>
                    </select>
                    <input v-model.number="draft.pickerQty" type="number" min="1" step="1" class="qty-input" />
                    <button type="button" class="btn" @click="addTool(draft)">添加</button>
                  </span>
                </div>
              </div>
            </fieldset>
          </article>
        </div>

        <footer class="modal-foot">
          <span class="bench-foot-tip">
            提交后：成功记录联动缺陷为「维修中」，并在管道检测页生成工具归还待办；失败项保留安排并标明原因，可调整后重试。
          </span>
          <span class="bench-foot-actions">
            <button class="btn" type="button" @click="closeBench">完成并关闭</button>
            <button class="btn primary" type="button" :disabled="!hasPendingDrafts" @click="submit">
              {{ submitLabel }}
            </button>
          </span>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listToolAvailability,
  moduleMeta,
  previewDispatch,
  runAction as applyAction,
  submitDispatch,
} from '@/api/local-service'
import { REPAIR_CREW, TOOL_CATALOG } from '@/data/dispatch'
import type { ToolItem } from '@/data/dispatch-types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('out_repair')
const columns = ['派遣编号', '批次编号', '缺陷来源', '维修人员', '预计工时', '携带工具', '出发时间', '返回时间', '维修状态']
const actions = ['下达派遣', '出发维修', '返回确认']
const statuses = ['待派遣', '已派遣', '维修中', '已返回']
const crew = REPAIR_CREW
const catalog = TOOL_CATALOG

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedIds = ref<Set<number>>(new Set())

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const today = new Date()
  const todayLabel = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`
  return [
    { label: '待派遣维修', value: rows.value.filter((row) => row.status === '待派遣').length },
    { label: '维修中数量', value: rows.value.filter((row) => row.status === '维修中').length },
    {
      label: '当日派遣',
      value: rows.value.filter(
        (row) =>
          (row.status === '已派遣' || row.status === '维修中') &&
          String(row.出发时间 ?? '').startsWith(todayLabel),
      ).length,
    },
  ]
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '外出维修登记入口尚未接入审批流'
}

function toggleSelect(id: number) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    const liveIds = new Set(rows.value.filter((row) => row.status === '待派遣').map((row) => Number(row.id)))
    selectedIds.value = new Set([...selectedIds.value].filter((id) => liveIds.has(id)))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '外出维修列表读取失败'
  }
}

/* ------------------------------ 派出工台 ------------------------------ */

type DraftState = 'draft' | 'confirmed' | 'failed' | 'unassigned'

type DraftRow = {
  repairId: number
  dispatchNo: string
  source: string
  worker: string
  startTime: string
  hours: number | string
  tools: ToolItem[]
  pickerName: string
  pickerQty: number
  state: DraftState
  reason?: string
}

const benchOpen = ref(false)
const drafts = ref<DraftRow[]>([])
const idempotencyKey = ref('')
const duplicateMessage = ref('')
const confirmedBatch = ref('')
const submitSummary = ref<{ text: string; tone: 'ok' | 'warn' } | null>(null)

// 提交后库存会变化，每次渲染重新取一次，保证工台里看到的是最新可借数。
function getToolAvailability() {
  return listToolAvailability()
}

function defaultStartTime(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function newKey(): string {
  return `dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function openBench() {
  const chosen = rows.value.filter((row) => selectedIds.value.has(Number(row.id)) && row.status === '待派遣')
  if (chosen.length === 0) {
    errorMessage.value = '请先勾选至少一条待派遣记录'
    return
  }
  const startTime = defaultStartTime()
  drafts.value = chosen.map((row) => ({
    repairId: Number(row.id),
    dispatchNo: String(row.派遣编号 ?? row.id),
    source: String(row.缺陷来源 ?? ''),
    worker: String(row.维修人员 ?? ''),
    startTime,
    hours: 4,
    tools: [],
    pickerName: '',
    pickerQty: 1,
    state: 'draft',
    reason: undefined,
  }))
  idempotencyKey.value = newKey()
  confirmedBatch.value = ''
  duplicateMessage.value = ''
  submitSummary.value = null
  benchOpen.value = true
}

function closeBench() {
  benchOpen.value = false
  reload()
}

function addTool(draft: DraftRow) {
  if (draft.pickerName === '') {
    return
  }
  const existing = draft.tools.find((tool) => tool.name === draft.pickerName)
  const qty = draft.pickerQty > 0 ? draft.pickerQty : 1
  if (existing) {
    existing.qty += qty
  } else {
    draft.tools.push({ name: draft.pickerName, qty })
  }
  draft.pickerName = ''
  draft.pickerQty = 1
}

function removeTool(draft: DraftRow, name: string) {
  draft.tools = draft.tools.filter((tool) => tool.name !== name)
}

const pendingDrafts = computed(() => drafts.value.filter((draft) => draft.state !== 'confirmed'))
const hasPendingDrafts = computed(() => pendingDrafts.value.length > 0)
const submitLabel = computed(() => {
  const base = `提交派出（${pendingDrafts.value.length} 条待处理）`
  return confirmedBatch.value ? `重试剩余派出（${pendingDrafts.value.length} 条）` : base
})

const previewItems = computed(() => {
  const items = pendingDrafts.value.map((draft) => ({
    repairId: draft.repairId,
    worker: draft.worker,
    startTime: draft.startTime,
    hours: Number(draft.hours),
    tools: draft.tools,
  }))
  return new Map(previewDispatch(items).map((item) => [item.repairId, item]))
})

type Hint = { level: 'ok' | 'unassigned' | 'error'; reason: string }

const hintMap = computed<Map<number, Hint>>(() => {
  const map = new Map<number, Hint>()
  for (const draft of drafts.value) {
    if (draft.state === 'confirmed') {
      continue
    }
    const preview = previewItems.value.get(draft.repairId)
    if (!preview) {
      continue
    }
    if (draft.state === 'failed' && draft.reason) {
      map.set(draft.repairId, {
        level: 'error',
        reason: preview.level === 'error' ? draft.reason : `上次派工失败：${draft.reason}（调整后可重试）`,
      })
    } else if (draft.state === 'unassigned') {
      map.set(draft.repairId, { level: 'unassigned', reason: draft.reason ?? '未选人，已回到待派遣' })
    } else if (preview.level === 'ok') {
      map.set(draft.repairId, { level: 'ok', reason: '校验通过' })
    } else if (preview.level === 'error') {
      map.set(draft.repairId, { level: 'error', reason: preview.reason ?? '派工校验未通过' })
    } else {
      map.set(draft.repairId, { level: 'unassigned', reason: preview.reason ?? '未选人，提交后回到待派遣' })
    }
  }
  return map
})

function submit() {
  duplicateMessage.value = ''
  submitSummary.value = null
  const items = pendingDrafts.value.map((draft) => ({
    repairId: draft.repairId,
    worker: draft.worker,
    startTime: draft.startTime,
    hours: Number(draft.hours),
    tools: draft.tools,
  }))
  const outcome = submitDispatch(items, idempotencyKey.value)
  if (outcome.duplicate) {
    duplicateMessage.value = outcome.message
    return
  }

  for (const draft of drafts.value) {
    if (draft.state === 'confirmed') {
      continue
    }
    const failed = outcome.failed.find((item) => item.repairId === draft.repairId)
    if (outcome.unassigned.includes(draft.repairId)) {
      draft.state = 'unassigned'
      draft.reason = '未选人，已回到待派遣'
    } else if (failed) {
      draft.state = 'failed'
      draft.reason = failed.reason
    } else if (outcome.confirmed.some((item) => item.repairId === draft.repairId)) {
      draft.state = 'confirmed'
      draft.reason = undefined
    }
  }
  if (outcome.batchNo) {
    confirmedBatch.value = outcome.batchNo
  }
  const parts: string[] = []
  if (outcome.confirmed.length > 0) {
    parts.push(`已确认派出 ${outcome.confirmed.length} 条（批次 ${outcome.batchNo ?? '—'}），对应缺陷已置为「维修中」，工具归还待办已生成`)
  }
  if (outcome.failed.length > 0) {
    parts.push(`${outcome.failed.length} 条派工失败，已保留安排并标出原因，可调整后重试`)
  }
  if (outcome.unassigned.length > 0) {
    parts.push(`${outcome.unassigned.length} 条未选人，已回到待派遣`)
  }
  submitSummary.value = {
    text: parts.join('；') || '本批没有可派出的记录',
    tone: outcome.failed.length > 0 ? 'warn' : 'ok',
  }
  // 部分成功后再重试属于新的派出批次，换新幂等键；首个批次不受影响。
  idempotencyKey.value = newKey()
  reload()
}

onMounted(reload)
</script>
