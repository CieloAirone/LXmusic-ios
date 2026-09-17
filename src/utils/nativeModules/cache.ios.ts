import RNFS from 'react-native-fs'
// Only disposable resources. AsyncStorage lives in Library, outside these paths.
const paths = ['local-media-metadata', 'lx-artwork'].map(name => `${RNFS.CachesDirectoryPath}/${name}`)
const sizeOf = async(path: string): Promise<number> => {
  if (!await RNFS.exists(path)) return 0
  const stat = await RNFS.stat(path)
  if (stat.isFile()) return Number(stat.size)
  const sizes = await Promise.all((await RNFS.readDir(path)).map(async item => sizeOf(item.path)))
  return sizes.reduce((total, size) => total + size, 0)
}
export const getAppCacheSize = async() => (await Promise.all(paths.map(sizeOf))).reduce((sum, size) => sum + size, 0)
export const clearAppCache = async() => {
  for (const path of paths) if (await RNFS.exists(path)) await RNFS.unlink(path)
}
