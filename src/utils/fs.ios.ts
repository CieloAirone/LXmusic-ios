// iOS sandbox file implementation; Android's Storage Access Framework is not loaded.
import RNFS from 'react-native-fs'
import { NativeModules } from 'react-native'
import { Buffer } from '@craftzdog/react-native-buffer'
import pako from 'pako'
import type { Encoding, FileType, HashAlgorithm, OpenDocumentOptions } from 'react-native-file-system'
export type { FileType } from 'react-native-file-system'

export const extname = (name: string) => name.lastIndexOf('.') > 0 ? name.substring(name.lastIndexOf('.') + 1) : ''
export const temporaryDirectoryPath = RNFS.CachesDirectoryPath
export const externalStorageDirectoryPath = RNFS.DocumentDirectoryPath
export const privateStorageDirectoryPath = RNFS.LibraryDirectoryPath
const pathOf = (path: string) => path.startsWith('file://') ? decodeURIComponent(path.slice(7)) : path
const mimeTypes: Record<string, string> = { mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', json: 'application/json', js: 'text/javascript', lrc: 'text/plain' }
const fileInfo = (item: RNFS.StatResult | RNFS.ReadDirItem): FileType => ({
  name: item.path.split('/').pop() ?? '',
  path: item.path,
  data: item.path,
  isDirectory: item.isDirectory(),
  isFile: item.isFile(),
  lastModified: item.mtime instanceof Date ? item.mtime.getTime() : Number(item.mtime ?? 0),
  canRead: true,
  size: Number(item.size),
  mimeType: mimeTypes[extname(item.path).toLowerCase()] ?? 'application/octet-stream',
})
export const getExternalStoragePaths = async(_removable?: boolean) => [externalStorageDirectoryPath]
export const stat = async(path: string) => fileInfo(await RNFS.stat(pathOf(path)))
// Managed storage is the app's Documents directory, exposed in the Files app.
export const selectManagedFolder = async(_persist = false) => stat(externalStorageDirectoryPath)
export const removeManagedFolder = async(_path: string) => {
  throw new Error('应用文稿目录由 iOS 管理，不能撤销授权')
}
export const getManagedFolders = async() => [externalStorageDirectoryPath]
export const getPersistedUriList = getManagedFolders
export const selectFile = async(options: OpenDocumentOptions): Promise<FileType | null> => {
  const path = await NativeModules.LXDocuments.pick(options) as string | null
  return path ? stat(path) : null
}
export const readDir = async(path: string) => (await RNFS.readDir(pathOf(path || externalStorageDirectoryPath))).map(fileInfo)
export const existsFile = async(path: string) => RNFS.exists(pathOf(path))
export const unlink = async(path: string): Promise<void> => {
  if (await existsFile(path)) await RNFS.unlink(pathOf(path))
}
export const mkdir = async(path: string) => { await RNFS.mkdir(pathOf(path)); return stat(path) }
export const hash = async(path: string, algorithm: HashAlgorithm) => RNFS.hash(pathOf(path), algorithm)
export const readFile = async(path: string, encoding: Encoding = 'utf8') => RNFS.readFile(pathOf(path), encoding)
export const writeFile = async(path: string, data: string, encoding: Encoding = 'utf8') => RNFS.writeFile(pathOf(path), data, encoding)
export const appendFile = async(path: string, data: string, encoding: Encoding = 'utf8') => RNFS.appendFile(pathOf(path), data, encoding)
export const moveFile = async(from: string, to: string) => { await RNFS.moveFile(pathOf(from), pathOf(to)); return true }
export const rename = async(path: string, name: string) => moveFile(path, pathOf(path).replace(/[^/]+$/, name))
export const gzipString = async(data: string, encoding: Encoding = 'utf8'): Promise<string> => Buffer.from(pako.gzip(Buffer.from(data, encoding))).toString('base64')
export const unGzipString = async(data: string, encoding: Encoding = 'utf8'): Promise<string> => Buffer.from(pako.ungzip(Buffer.from(data, 'base64'))).toString(encoding)
export const gzipFile = async(from: string, to: string) => writeFile(to, await gzipString(await readFile(from, 'base64'), 'base64'), 'base64')
export const unGzipFile = async(from: string, to: string) => writeFile(to, await unGzipString(await readFile(from, 'base64'), 'base64'), 'base64')
export const downloadFile = (url: string, path: string, options: Omit<RNFS.DownloadFileOptions, 'fromUrl' | 'toFile'> = {}) => {
  const job = RNFS.downloadFile({
    fromUrl: url,
    toFile: pathOf(path),
    background: true,
    discretionary: false,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...options,
  })
  return { ...job, promise: job.promise.finally(() => { RNFS.completeHandlerIOS(job.jobId) }) }
}
export const stopDownload = (jobId: number) => { RNFS.stopDownload(jobId) }
