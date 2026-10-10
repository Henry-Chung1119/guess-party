/**
 * 記憶體版的微信雲資料庫（只實作本專案用到的子集）。
 *
 * - 每個操作本身是原子的（與真實資料庫一致），但操作之間會插入隨機延遲，
 *   讓 Promise.all 併發測試能真正交錯執行，暴露競態問題。
 * - add 時 _id 重複會丟出與 wx-server-sdk 相同語意的錯誤（E11000 / -502001）。
 */
import type { CollectionRef, Db, DocData, DocRef, QueryRef } from '../src/db'

interface Cmd {
  __cmd: string
  v: unknown
}
const cmd = (op: string, v: unknown): Cmd => ({ __cmd: op, v })
const isCmd = (x: unknown): x is Cmd => typeof x === 'object' && x !== null && '__cmd' in x

const clone = <T>(x: T): T => structuredClone(x)
const tick = () => new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 3)))

const getPath = (doc: DocData, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as DocData)[k] : undefined), doc)

function setPath(doc: DocData, path: string, value: unknown): void {
  const keys = path.split('.')
  let cur: DocData = doc
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    const next = cur[k]
    if (next === null || next === undefined) {
      cur[k] = {}
    } else if (typeof next !== 'object') {
      throw new Error(`cannot set path ${path} through non-object`)
    }
    cur = cur[k] as DocData
  }
  cur[keys[keys.length - 1]!] = value
}

const valueEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const matchEq = (val: unknown, target: unknown) =>
  Array.isArray(val) && !Array.isArray(target) ? val.some((x) => valueEq(x, target)) : valueEq(val, target)

function matchCond(val: unknown, cond: unknown): boolean {
  if (!isCmd(cond)) return matchEq(val, cond)
  const list = Array.isArray(cond.v) ? (cond.v as unknown[]) : []
  switch (cond.__cmd) {
    case 'eq':
      return matchEq(val, cond.v)
    case 'neq':
      return !matchEq(val, cond.v)
    case 'lt':
      return typeof val === 'number' && val < (cond.v as number)
    case 'in':
      return Array.isArray(val) ? val.some((x) => list.some((y) => valueEq(x, y))) : list.some((y) => valueEq(val, y))
    case 'nin':
      return !(Array.isArray(val) ? val.some((x) => list.some((y) => valueEq(x, y))) : list.some((y) => valueEq(val, y)))
    default:
      throw new Error(`unsupported query command ${cond.__cmd}`)
  }
}

const matches = (doc: DocData, query: DocData) => Object.entries(query).every(([p, c]) => matchCond(getPath(doc, p), c))

function applyUpdate(doc: DocData, data: DocData): void {
  for (const [path, v] of Object.entries(data)) {
    if (!isCmd(v)) {
      setPath(doc, path, clone(v))
      continue
    }
    const cur = getPath(doc, path)
    switch (v.__cmd) {
      case 'inc':
        setPath(doc, path, (typeof cur === 'number' ? cur : 0) + (v.v as number))
        break
      case 'max':
        setPath(doc, path, Math.max(typeof cur === 'number' ? cur : -Infinity, v.v as number))
        break
      case 'push':
        setPath(doc, path, [...(Array.isArray(cur) ? cur : []), ...(v.v as unknown[])])
        break
      case 'pull':
        if (Array.isArray(cur)) setPath(doc, path, cur.filter((x) => !valueEq(x, v.v)))
        break
      default:
        throw new Error(`unsupported update command ${v.__cmd}`)
    }
  }
}

export interface FakeDb extends Db {
  /** 測試用：直接讀取集合內容 */
  dump(collection: string): DocData[]
}

export function createFakeDb(): FakeDb {
  const store = new Map<string, Map<string, DocData>>()
  const col = (name: string): Map<string, DocData> => {
    let m = store.get(name)
    if (!m) {
      m = new Map()
      store.set(name, m)
    }
    return m
  }
  let seq = 0

  function makeQuery(name: string, query: DocData, limit = 100, order?: { field: string; dir: 'asc' | 'desc' }): QueryRef {
    const select = () => {
      let docs = [...col(name).values()].filter((d) => matches(d, query))
      if (order) {
        const sign = order.dir === 'asc' ? 1 : -1
        docs = docs.sort((a, b) => {
          const av = getPath(a, order.field) as number | string | Date
          const bv = getPath(b, order.field) as number | string | Date
          return av < bv ? -sign : av > bv ? sign : 0
        })
      }
      return docs.slice(0, limit)
    }
    return {
      limit: (n) => makeQuery(name, query, n, order),
      orderBy: (field, dir) => makeQuery(name, query, limit, { field, dir }),
      async get() {
        await tick()
        return { data: select().map(clone) }
      },
      async count() {
        await tick()
        return { total: [...col(name).values()].filter((d) => matches(d, query)).length }
      },
      async update({ data }) {
        await tick()
        const docs = select()
        for (const d of docs) applyUpdate(d, data)
        return { stats: { updated: docs.length } }
      },
      async remove() {
        await tick()
        const docs = select()
        for (const d of docs) col(name).delete(d._id as string)
        return { stats: { removed: docs.length } }
      },
    }
  }

  function makeDoc(name: string, id: string): DocRef {
    return {
      async get() {
        await tick()
        const d = col(name).get(id)
        return { data: d ? clone(d) : null }
      },
      async update({ data }) {
        await tick()
        const d = col(name).get(id)
        if (!d) return { stats: { updated: 0 } }
        applyUpdate(d, data)
        return { stats: { updated: 1 } }
      },
      async set({ data }) {
        await tick()
        col(name).set(id, { ...clone(data), _id: id })
        return {}
      },
      async remove() {
        await tick()
        return { stats: { removed: col(name).delete(id) ? 1 : 0 } }
      },
    }
  }

  function makeCollection(name: string): CollectionRef {
    return {
      doc: (id) => makeDoc(name, id),
      async add({ data }) {
        await tick()
        const id = typeof data._id === 'string' ? data._id : `auto_${++seq}`
        if (col(name).has(id)) {
          throw Object.assign(new Error('E11000 duplicate key error collection'), { errCode: -502001 })
        }
        col(name).set(id, { ...clone(data), _id: id })
        return { _id: id }
      },
      where: (query) => makeQuery(name, query),
    }
  }

  return {
    collection: makeCollection,
    command: {
      inc: (n) => cmd('inc', n),
      max: (n) => cmd('max', n),
      push: (values) => cmd('push', values),
      pull: (value) => cmd('pull', value),
      neq: (value) => cmd('neq', value),
      lt: (value) => cmd('lt', value),
      in: (values) => cmd('in', values),
      nin: (values) => cmd('nin', values),
    },
    dump: (name) => [...col(name).values()].map(clone),
  }
}
