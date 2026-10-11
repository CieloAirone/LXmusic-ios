import Player, { type NowPlayingMetadata, type NowPlayingTitles, type PlayerOptions, type Track } from 'react-native-track-player'
import { NativeModules } from 'react-native'
import { cachedURL, cacheURL, clearCache, configureCache, getCacheSize, isCached } from './player/ios/cache'
export * from 'react-native-track-player'

// The Android fork converts native milliseconds to seconds in its JS getters.
// RNTrackPlayer.swift / SwiftAudioEx already return seconds on iOS. Bypass only
// these three conversions; seekTo and metadata already use seconds on both sides.
const getPosition = async(): Promise<number> => NativeModules.TrackPlayerModule.getPosition()
const getDuration = async(): Promise<number> => NativeModules.TrackPlayerModule.getDuration()
const getBufferedPosition = async(): Promise<number> => NativeModules.TrackPlayerModule.getBufferedPosition()

let metadata: NowPlayingMetadata = {}
const updateNowPlayingMetadata = async(value: NowPlayingMetadata, _playing: boolean) => {
  metadata = { ...metadata, ...value }
  // The Android fork added an extra "playing" argument that iOS does not accept.
  await NativeModules.TrackPlayerModule.updateNowPlayingMetadata(metadata)
}
const updateNowPlayingTitles = async(value: NowPlayingTitles) => updateNowPlayingMetadata(value, true)
const setupPlayer = async(options: PlayerOptions = {}) => {
  configureCache(options.maxCacheSize ?? 1024 * 1024)
  await Player.setupPlayer(options)
}
const add = async(input: Track | Track[], index?: number) => {
  const tracks = Array.isArray(input) ? input : [input]
  const converted = await Promise.all(tracks.map(async track => {
    if (typeof track.url !== 'string' || String(track.id).endsWith('//default')) return track
    const original = track.url
    // Cache lookup is optional; a filesystem failure must not block streaming.
    const url = await cachedURL(original).catch(() => original)
    if (url === original) void cacheURL(original, { 'User-Agent': track.userAgent ?? 'Mozilla/5.0', ...track.headers }).catch(error => { console.warn('Audio cache:', error.message) })
    return { ...track, url: url.startsWith('/') ? `file://${url}` : url, headers: { 'User-Agent': track.userAgent ?? 'Mozilla/5.0', ...track.headers } }
  }))
  await Player.add(converted, index)
}
export default { ...Player, setupPlayer, add, getPosition, getDuration, getBufferedPosition, updateNowPlayingMetadata, updateNowPlayingTitles, isCached, getCacheSize, clearCache }
