import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'underground-pipeline-inspection:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedRowsMissingByField(
  stored: EntryRow[],
  seeded: EntryRow[],
  field: string,
): EntryRow[] {
  const storedValues = new Set(stored.map((row) => String(row[field] ?? '')))
  return seeded.filter((row) => !storedValues.has(String(row[field] ?? '')))
}

function migrateBusinessRows(
  data: Record<string, EntryRow[]>,
  fallback: Record<string, EntryRow[]>,
): Record<string, EntryRow[]> {
  const next = { ...fallback, ...data }

  for (const [key, field] of [
    ['defect', '缺陷编号'],
    ['out_repair', '派遣编号'],
  ] as const) {
    const stored = [...(data[key] ?? [])]
    const additions = seedRowsMissingByField(stored, fallback[key], field)
    if (additions.length > 0) {
      let nextId = stored.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
      next[key] = [
        ...stored,
        ...additions.map((row) => {
          const copied = clone(row)
          copied.id = ++nextId
          return copied
        }),
      ]
    }
  }

  return next
}

function persist(data: Record<string, EntryRow[]>): void {
  cache = data
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const migrated = migrateBusinessRows(parsed, fallback)
    persist(migrated)
    return migrated
  } catch {
    persist(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
