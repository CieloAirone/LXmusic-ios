import RNFS from 'react-native-fs'
import { stringMd5 } from 'react-native-quick-md5'

const directory = `${RNFS.CachesDirectoryPath}/LXAudio`
let limit = 1024 * 1024 * 1024
let generation = 0
let clearing: Promise<void> | null = null
const jobs = new Map<string, { id: number | null, promise: Promise<void> }>()
const pathFor = (url: string) => `${directory}/${stringMd5(url)}.audio`
export const configureCache = (kilobytes: number) => { limit = Math.max(0, kilobytes * 1024) }
const files = async() => await RNFS.exists(directory) ? RNFS.readDir(directory) : []
export const isCached = async(url: string) => RNFS.exists(pathFor(url))
export const getCacheSize = async() => (await files()).reduce((size, file) => size + Number(file.size), 0)
const trim = async() => {
  const completed = (await files()).filter(file => file.name.endsWith('.audio')).sort((a, b) => (a.mtime?.getTime() ?? 0) - (b.mtime?.getTime() ?? 0))
  let size = completed.reduce((total, file) => total + Number(file.size), 0)
  for (const file of completed) {
    if (size <= limit) break
    await RNFS.unlink(file.path).catch(() => {})
    size -= Number(file.size)
  }
}
export const clearCache = async() => {
  if (clearing) return clearing
  generation++
  const pending = [...jobs.values()]
  for (const job of pending) if (job.id !== null) RNFS.stopDownload(job.id)
  const operation = (async() => {
    await Promise.allSettled(pending.map(async job => job.promise))
    if (await RNFS.exists(directory)) await RNFS.unlink(directory)
  })()
  clearing = operation
  try { await operation } finally { if (clearing === operation) clearing = null }
}
export const cachedURL = async(url: string) => await isCached(url) ? `file://${pathFor(url)}` : url
// Publish only complete successful responses; clearing invalidates in-flight work.
export const cacheURL = async(url: string, headers?: Record<string, string>): Promise<void> => {
  if (!limit || clearing !== null || !/^https?:\/\//.test(url) || /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(url)) return
  const existing = jobs.get(url)
  if (existing) return existing.promise
  const current = generation
  const path = pathFor(url)
  const job = { id: null as number | null, promise: Promise.resolve() }
  const operation = async() => {
    if (await isCached(url)) return
    await RNFS.mkdir(directory)
    if (current !== generation) return
    let rejectedContent = false
    const task = RNFS.downloadFile({
      fromUrl: url,
      toFile: `${path}.part`,
      headers,
      background: true,
      discretionary: false,
      begin: response => {
        const contentType = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
        rejectedContent = /mpegurl|dash\+xml|text\/|json/i.test(String(contentType ?? ''))
        if (rejectedContent || response.contentLength > limit) RNFS.stopDownload(response.jobId)
      },
      progressInterval: 1000,
      progress: response => { if (response.bytesWritten > limit) RNFS.stopDownload(response.jobId) },
    })
    job.id = task.jobId
    try {
      const result = await task.promise
      if (rejectedContent || current !== generation || result.statusCode < 200 || result.statusCode >= 300 || result.bytesWritten === 0 || result.bytesWritten > limit) return
      await RNFS.moveFile(`${path}.part`, path)
      await trim()
    } finally {
      RNFS.completeHandlerIOS(task.jobId)
      if (await RNFS.exists(`${path}.part`)) await RNFS.unlink(`${path}.part`)
    }
  }
  job.promise = operation().finally(() => { if (jobs.get(url) === job) jobs.delete(url) })
  jobs.set(url, job)
  await job.promise
}
