import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '@/utils/log'

const partKeyPrefix = '@___PART___'
const partKeyArrPrefix = '@___PART_A___'
const limit = 500000
let generation = 0
let operations: Promise<unknown> = Promise.resolve()

// Serialize readers as well as writers: old shards must outlive any active read.
const run = async<T>(name: string, operation: () => Promise<T>): Promise<T> => {
  const result = operations.then(operation)
  operations = result.catch(() => {})
  return result.catch((error: unknown) => {
    log.error('storage error[' + name + ']:', error instanceof Error ? error.message : String(error))
    throw error
  })
}
const partKeys = (value: string | null): string[] => {
  if (value?.startsWith(partKeyPrefix)) return value.slice(partKeyPrefix.length).split(',')
  if (value?.startsWith(partKeyArrPrefix)) return JSON.parse(value.slice(partKeyArrPrefix.length)) as string[]
  return []
}
const decode = async<T>(value: string | null): Promise<T | null> => {
  if (value == null) return null
  const keys = partKeys(value)
  if (!keys.length) return JSON.parse(value) as T
  const parts = await AsyncStorage.multiGet(keys)
  if (parts.some(([, data]) => data == null)) throw new Error('Incomplete stored data')
  return JSON.parse(parts.map(([, data]) => data).join('')) as T
}

const save = async(entries: Array<[string, any]>) => {
  // Keep the last entry for duplicate keys, and serialize everything before IO.
  const values = [...new Map(entries)].map(([key, value]): [string, string] => {
    const encoded = JSON.stringify(value)
    if (encoded == null) throw new Error('Cannot store undefined')
    return [key, encoded]
  })
  if (!values.length) return
  const previous = await AsyncStorage.multiGet(values.map(([key]) => key))
  const shards: Array<[string, string]> = []
  const manifests: Array<[string, string]> = []
  const version = Date.now().toString(36) + '-' + (++generation).toString(36) + '-' + Math.random().toString(36).slice(2)
  for (const [key, value] of values) {
    if (value.length <= limit) {
      manifests.push([key, value])
      continue
    }
    const keys: string[] = []
    for (let offset = 0; offset < value.length; offset += limit) {
      const part = partKeyArrPrefix + JSON.stringify([key, version, offset])
      keys.push(part)
      shards.push([part, value.slice(offset, offset + limit)])
    }
    manifests.push([key, partKeyArrPrefix + JSON.stringify(keys)])
  }
  // Stage immutable shards first. Never remove the committed value before writing.
  // If either write fails (even partly), retain both generations for safe reads.
  if (shards.length) await AsyncStorage.multiSet(shards)
  await AsyncStorage.multiSet(manifests)
  const obsolete = previous.flatMap(([, value]) => partKeys(value))
  if (obsolete.length) {
    // A cleanup failure must not report a successfully committed save as failed.
    await AsyncStorage.multiRemove(obsolete).catch((error: unknown) => {
      log.error('storage shard cleanup:', String(error))
    })
  }
}
const remove = async(keys: string[]) => {
  if (!keys.length) return
  const values = await AsyncStorage.multiGet(keys)
  await AsyncStorage.multiRemove(keys)
  const shards = values.flatMap(([, value]) => partKeys(value))
  if (shards.length) await AsyncStorage.multiRemove(shards)
}

export const saveData = async(key: string, value: any) => run('saveData', async() => save([[key, value]]))
export const saveDataMultiple = async(values: Array<[string, any]>) => run('saveDataMultiple', async() => save(values))
export const getData = async<T = unknown>(key: string): Promise<T | null> => run('getData', async() => decode<T>(await AsyncStorage.getItem(key)))
export const getDataMultiple = async<T extends readonly string[]>(keys: T) => run('getDataMultiple', async() => {
  const values = await AsyncStorage.multiGet(keys)
  const decoded = await Promise.all(values.map(async([key, value]) => [key, await decode(value)]))
  return decoded as { [K in keyof T]: [T[K], unknown] }
})
export const removeData = async(key: string) => run('removeData', async() => remove([key]))
export const removeDataMultiple = async(keys: string[]) => run('removeDataMultiple', async() => remove(keys))
export const getAllKeys = async() => run('getAllKeys', async() => AsyncStorage.getAllKeys())
export const clearAll = async() => run('clearAll', async() => AsyncStorage.clear())

export { useAsyncStorage } from '@react-native-async-storage/async-storage'
