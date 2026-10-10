/**
 * 本專案實際用到的雲資料庫介面子集。
 * 以介面隔離 wx-server-sdk，讓雲函數邏輯可在測試中以記憶體假資料庫執行。
 */
export type DocData = Record<string, unknown>

export interface DocRef {
  get(): Promise<{ data: DocData | null }>
  update(opts: { data: DocData }): Promise<{ stats: { updated: number } }>
  set(opts: { data: DocData }): Promise<unknown>
  remove(): Promise<unknown>
}

export interface QueryRef {
  get(): Promise<{ data: DocData[] }>
  count(): Promise<{ total: number }>
  update(opts: { data: DocData }): Promise<{ stats: { updated: number } }>
  remove(): Promise<unknown>
  limit(n: number): QueryRef
  orderBy(field: string, order: 'asc' | 'desc'): QueryRef
}

export interface CollectionRef {
  doc(id: string): DocRef
  add(opts: { data: DocData }): Promise<{ _id: string }>
  where(query: DocData): QueryRef
}

export interface DbCommand {
  inc(n: number): unknown
  max(n: number): unknown
  push(values: unknown[]): unknown
  pull(value: unknown): unknown
  neq(value: unknown): unknown
  lt(value: number): unknown
  in(values: unknown[]): unknown
  nin(values: unknown[]): unknown
}

export interface Db {
  collection(name: string): CollectionRef
  command: DbCommand
}
