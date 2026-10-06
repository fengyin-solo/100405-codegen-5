import { initialDispatchState } from './dispatch'
import type { DispatchState } from './dispatch-types'

// 派出批次与工具归还待办单独存一份，不和业务行混在一起。
const DISPATCH_KEY = 'underground-pipeline-inspection:dispatch'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readState(): DispatchState {
  const fallback = initialDispatchState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(DISPATCH_KEY)
  if (!raw) {
    window.localStorage.setItem(DISPATCH_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DispatchState>
    return {
      seq: typeof parsed.seq === 'number' ? parsed.seq : fallback.seq,
      batches: Array.isArray(parsed.batches) ? parsed.batches : fallback.batches,
      todos: Array.isArray(parsed.todos) ? parsed.todos : fallback.todos,
    }
  } catch {
    window.localStorage.setItem(DISPATCH_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: DispatchState | null = null

export function dispatchState(): DispatchState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

export function saveDispatchState(state: DispatchState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DISPATCH_KEY, JSON.stringify(state))
  }
}

export function resetDispatchState(): DispatchState {
  const fresh = clone(initialDispatchState())
  saveDispatchState(fresh)
  return fresh
}
