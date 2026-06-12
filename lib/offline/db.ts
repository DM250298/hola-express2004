/**
 * Capa de IndexedDB para el modo offline del POS.
 *
 * FASE 2 — POS offline. Un autoservicio 24 h no puede dejar de vender si se
 * cae internet. Guardamos en el navegador:
 *   • `catalogo`          → snapshot del catálogo de productos para buscar sin red.
 *   • `ventas_pendientes` → ventas hechas offline, en cola para sincronizar.
 *   • `meta`              → marcas varias (última sincronización de catálogo, etc).
 *
 * Wrapper mínimo, sin dependencias externas, basado en Promesas.
 */

const NOMBRE_DB = 'hola-express-offline'
// v2: stores del kiosco de fichaje (RRHH Sprint 2).
const VERSION_DB = 2

export const STORE_CATALOGO = 'catalogo'
export const STORE_VENTAS_PENDIENTES = 'ventas_pendientes'
export const STORE_META = 'meta'
export const STORE_FICHAJES_PENDIENTES = 'fichajes_pendientes'
export const STORE_EMPLEADOS_KIOSCO = 'empleados_kiosco'

function hayIndexedDB(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

let promesaDb: Promise<IDBDatabase> | null = null

function abrirDb(): Promise<IDBDatabase> {
  if (!hayIndexedDB()) {
    return Promise.reject(new Error('IndexedDB no disponible'))
  }
  if (promesaDb) return promesaDb

  promesaDb = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NOMBRE_DB, VERSION_DB)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_CATALOGO)) {
        db.createObjectStore(STORE_CATALOGO, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_VENTAS_PENDIENTES)) {
        db.createObjectStore(STORE_VENTAS_PENDIENTES, {
          keyPath: 'cliente_uuid',
        })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'clave' })
      }
      if (!db.objectStoreNames.contains(STORE_FICHAJES_PENDIENTES)) {
        db.createObjectStore(STORE_FICHAJES_PENDIENTES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_EMPLEADOS_KIOSCO)) {
        db.createObjectStore(STORE_EMPLEADOS_KIOSCO, { keyPath: 'id' })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir la DB'))
  })

  return promesaDb
}

function promesaRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Error de IndexedDB'))
  })
}

/** Devuelve todos los registros de un store. Array vacío si no hay IndexedDB. */
export async function idbObtenerTodo<T>(store: string): Promise<T[]> {
  if (!hayIndexedDB()) return []
  try {
    const db = await abrirDb()
    const tx = db.transaction(store, 'readonly')
    return await promesaRequest<T[]>(tx.objectStore(store).getAll())
  } catch {
    return []
  }
}

/** Devuelve un registro por su clave, o `null` si no existe. */
export async function idbObtener<T>(
  store: string,
  clave: IDBValidKey
): Promise<T | null> {
  if (!hayIndexedDB()) return null
  try {
    const db = await abrirDb()
    const tx = db.transaction(store, 'readonly')
    const res = await promesaRequest<T | undefined>(
      tx.objectStore(store).get(clave)
    )
    return res ?? null
  } catch {
    return null
  }
}

/** Inserta o reemplaza un registro. */
export async function idbGuardar<T>(store: string, valor: T): Promise<void> {
  if (!hayIndexedDB()) return
  const db = await abrirDb()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(valor)
  await esperarTx(tx)
}

/** Inserta o reemplaza muchos registros en una sola transacción. */
export async function idbGuardarLote<T>(
  store: string,
  valores: T[]
): Promise<void> {
  if (!hayIndexedDB() || valores.length === 0) return
  const db = await abrirDb()
  const tx = db.transaction(store, 'readwrite')
  const os = tx.objectStore(store)
  for (const v of valores) os.put(v)
  await esperarTx(tx)
}

/** Elimina un registro por su clave. */
export async function idbEliminar(
  store: string,
  clave: IDBValidKey
): Promise<void> {
  if (!hayIndexedDB()) return
  const db = await abrirDb()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(clave)
  await esperarTx(tx)
}

/** Vacía por completo un store. */
export async function idbVaciar(store: string): Promise<void> {
  if (!hayIndexedDB()) return
  const db = await abrirDb()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).clear()
  await esperarTx(tx)
}

/** Cuenta los registros de un store. */
export async function idbContar(store: string): Promise<number> {
  if (!hayIndexedDB()) return 0
  try {
    const db = await abrirDb()
    const tx = db.transaction(store, 'readonly')
    return await promesaRequest<number>(tx.objectStore(store).count())
  } catch {
    return 0
  }
}

function esperarTx(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Transacción fallida'))
    tx.onabort = () => reject(tx.error ?? new Error('Transacción abortada'))
  })
}

// ─── Helpers de `meta` (clave/valor) ─────────────────────────────────────────

interface RegistroMeta {
  clave: string
  valor: unknown
}

export async function metaObtener<T>(clave: string): Promise<T | null> {
  const reg = await idbObtener<RegistroMeta>(STORE_META, clave)
  return reg ? (reg.valor as T) : null
}

export async function metaGuardar(clave: string, valor: unknown): Promise<void> {
  await idbGuardar<RegistroMeta>(STORE_META, { clave, valor })
}
