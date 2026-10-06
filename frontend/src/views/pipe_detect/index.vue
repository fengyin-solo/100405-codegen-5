<template>
  <section class="page" data-module="pipe_detect">
    <header class="page-head">
      <div>
        <h2>管道检测管理</h2>
        <p class="page-desc">维护检测记录，围绕检测编号、检测管段、检测方式、检测设备做登记、筛选与状态流转。</p>
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
      <header class="todo-head">
        <h3>工具归还待办（外出维修派出后生成）</h3>
        <span class="todo-count">未归还 {{ todos.length }} 条</span>
      </header>
      <table v-if="todos.length" class="data-table todo-table">
        <thead>
          <tr>
            <th>派遣编号</th>
            <th>派出批次</th>
            <th>维修人员</th>
            <th>待归还工具</th>
            <th>计划返回时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.id">
            <td>{{ todo.dispatchNo }}</td>
            <td>{{ todo.batchNo }}</td>
            <td>{{ todo.worker }}</td>
            <td>
              <span v-for="(tool, index) in todo.tools" :key="tool.name" class="tool-chip">
                {{ tool.name }} × {{ tool.qty }}<span v-if="index < todo.tools.length - 1">；</span>
              </span>
            </td>
            <td>{{ todo.plannedReturn }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="returnTools(todo.id)">确认归还入库</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state todo-empty">当前没有待归还的维修工具</p>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
  listReturnTodos,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { ReturnTodo } from '@/data/dispatch-types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pipe_detect')
const columns = ["检测编号", "检测管段", "检测方式", "检测设备", "检测日期", "检测长度", "检测结果", "检测状态"]
const actions = ["安排检测", "记录结果", "标记复测"]
const statuses = ["待检测", "检测中", "已完成", "需复测"]
const stats = [{"label": "待检测管段", "value": 0}, {"label": "已完成管段", "value": 0}, {"label": "需复测管段", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const todos = ref<ReturnTodo[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

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

function loadTodos() {
  todos.value = listReturnTodos(false)
}

function returnTools(todoId: number) {
  errorMessage.value = ''
  const result = confirmToolReturn(todoId)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  loadTodos()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    loadTodos()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管道检测列表读取失败'
  }
}

onMounted(reload)
</script>
