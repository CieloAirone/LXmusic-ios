import { NativeModules } from 'react-native'
import RNFS from 'react-native-fs'
import { stringMd5 } from 'react-native-quick-md5'
import { readDir, extname, readFile, existsFile } from '@/utils/fs'
import type { MusicMetadata, MusicMetadataFull } from 'react-native-local-media-metadata'
export type { MusicMetadata, MusicMetadataFull } from 'react-native-local-media-metadata'

const editsDir = `${RNFS.LibraryDirectoryPath}/LXMediaEdits`
const keyFor = (path: string) => stringMd5(path)
type Edits = Partial<MusicMetadata> & { pic?: string, lyric?: string }
const editPath = (path: string) => `${editsDir}/${keyFor(path)}.json`
const edits = async(path: string): Promise<Edits> => await existsFile(editPath(path)) ? JSON.parse(await readFile(editPath(path))) : {}
// Preserve originals: edits are persistent app metadata, not embedded audio tags.
const queue = new Map<string, Promise<void>>()
const update = async(path: string, value: Edits, overwrite = true) => {
  const operation = (queue.get(path) ?? Promise.resolve()).catch(() => {}).then(async() => {
    await RNFS.mkdir(editsDir)
    const previous = await edits(path)
    const next = overwrite ? { ...previous, ...value } : { ...value, ...previous }
    await NativeModules.LXDocuments.writeTextAtomic(editPath(path), JSON.stringify(next))
  })
  queue.set(path, operation)
  try { await operation } finally { if (queue.get(path) === operation) queue.delete(path) }
}
export const scanAudioFiles = async(path: string) => (await readDir(path)).filter(file => file.isFile && file.mimeType.startsWith('audio/'))
export const readMetadata = async(path: string): Promise<MusicMetadataFull | null> => {
  const [metadata, overrides] = await Promise.all([NativeModules.LXMedia.readMetadata(path) as Promise<MusicMetadataFull>, edits(path)])
  return { ...metadata, ...overrides }
}
export const writeMetadata = async(path: string, metadata: MusicMetadata, overwrite = false) => {
  const existing = await readMetadata(path)
  const value = Object.fromEntries(Object.entries(metadata).filter(([key]) => overwrite || !existing?.[key as keyof MusicMetadata]))
  await update(path, value)
}
export const readPic = async(path: string): Promise<string> => {
  const value = await edits(path)
  return value.pic ?? NativeModules.LXMedia.readPic(path)
}
export const writePic = async(path: string, picture: string) => {
  await RNFS.mkdir(editsDir)
  const destination = `${editsDir}/${keyFor(path)}-${Date.now()}.${extname(picture) || 'jpg'}`
  if (picture !== destination) await RNFS.copyFile(picture, destination)
  await update(path, { pic: destination })
}
export const readLyric = async(path: string, readSidecar = true): Promise<string> => {
  const value = await edits(path)
  if (value.lyric !== undefined) return value.lyric
  const sidecar = path.replace(/\.[^/.]+$/, '.lrc')
  if (readSidecar && await existsFile(sidecar)) return readFile(sidecar)
  return NativeModules.LXMedia.readLyric(path)
}
export const writeLyric = async(path: string, lyric: string) => update(path, { lyric })
