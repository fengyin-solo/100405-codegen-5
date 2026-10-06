<template>
  <section class="page" data-module="pipe_detect">
    <header class="page-head">
      <div>
        <h2>管道检测管理</h2>
        <p class="page-desc">维护检测记录；外出维修派出成功后，本页会自动生成「待归还工具」待办，确认后释放工具库存。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检测记录</button>
        <button class="btn" type="button" @click="exportRows">导出管道检测清单</button>
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

    <section class="todo-panel">
      <div class="todo-head">
        <h3>工具归还待办</h3>
        <span>{{ toolReturnTodos.length }} 件待归还</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>待办编号</th>
            <th>关联派遣</th>
            <th>管段 / 缺陷</th>
            <th>应归还工具</th>
            <th>应还时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in toolReturnTodos" :key="String(todo.id)">
            <td>{{ todo['检测编号'] }}</td>
            <td>{{ todo['关联派遣'] }}</td>
            <td>{{ todo['检测管段'] }}</td>
            <td>{{ todo['检测设备'] }}</td>
            <td>{{ returnDueTime(todo) }}</td>
            <td><span class="todo-badge">待归还工具</span></td>
            <td>
              <button class="link" type="button" @click="returnTools(todo)">确认归还</button>
            </td>
          </tr>
          <tr v-if="!toolReturnTodos.length">
            <td colspan="7" class="empty-state">暂无工具归还待办</td>
          </tr>
        </tbody>
      </table>
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
            <template v-if="String(row.status) === '待归还工具'">
              <button class="link" type="button" @click="returnTools(row)">确认归还</button>
            </template>
            <template v-else>
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无管道检测数据，可先登记检测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管道检测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  confirmToolReturn,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pipe_detect')
const columns = ['检测编号', '检测管段', '检测方式', '检测设备', '检测日期', '检测长度', '检测结果', '关联派遣', '检测状态']
const actions = ['安排检测', '记录结果', '标记复测']
const statuses = ['待归还工具', '待检测', '检测中', '已完成', '需复测']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const toolReturnTodos = computed(() =>
  rows.value.filter((row) => String(row.status) === '待归还工具'),
)
const stats = computed(() => [
  { label: '待归还工具', value: toolReturnTodos.value.length },
  { label: '待检测管段', value: rows.value.filter((row) => row.status === '待检测').length },
  { label: '已完成管段', value: rows.value.filter((row) => row.status === '已完成').length },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function returnDueTime(row: EntryRow): string {
  const result = String(row['检测结果'] ?? '')
  const matched = result.match(/应还时间\s*([^，；]+)/)
  return matched?.[1] ?? String(row['检测日期'] ?? '—')
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '检测记录登记入口尚未接入审批流'
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

function returnTools(row: EntryRow) {
  errorMessage.value = ''
  const result = confirmToolReturn(Number(row.id))
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管道检测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.todo-panel {
  background: #fff;
  border: 1px solid #f8d98d;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 14px;
}
.todo-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.todo-head h3 {
  margin: 0;
}
.todo-head span {
  color: #92400e;
  font-size: 13px;
}
.todo-badge {
  display: inline-block;
  background: #fef3c7;
  color: #92400e;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
</style>
