// iOS has no Android-style cross-app overlay. Keep lyric events for lock-screen titles.
import Lyric, { type Lines } from 'lrc-file-parser'
import { Alert } from 'react-native'

let sending = false
let original = ''
let translated = ''
let romanized = ''
let showTranslation = false
let showRoma = false
let lines: Lines = []
type Handler = (line: { text: string, extendedLyrics: string[] }) => void
const listeners = new Set<Handler>()
const lyric = new Lyric({
  onSetLyric: value => { lines = value },
  onPlay: (index, text) => {
    if (!sending) return
    const extendedLyrics = lines[index]?.extendedLyrics ?? []
    for (const listener of listeners) listener({ text, extendedLyrics })
  },
})
const refresh = () => { lyric.setLyric(original, [showTranslation ? translated : '', showRoma ? romanized : ''].filter(Boolean)) }
export const setSendLyricTextEvent = async(value: boolean) => { sending = value }
export const setLyric = async(text: string, translation: string, roma: string) => {
  original = text; translated = translation; romanized = roma; refresh()
}
export const play = async(time: number) => { lyric.play(time) }
export const pause = async() => { lyric.pause() }
export const setPlaybackRate = async(rate: number) => { lyric.setPlaybackRate(rate) }
export const toggleTranslation = async(value: boolean) => { showTranslation = value; refresh() }
export const toggleRoma = async(value: boolean) => { showRoma = value; refresh() }
export const onLyricLinePlay = (handler: Handler) => {
  listeners.add(handler)
  return () => { listeners.delete(handler) }
}
const unavailable = () => { Alert.alert('桌面歌词', 'iOS 不支持跨应用悬浮歌词，请使用播放页歌词；锁屏播放控制仍可正常使用。') }
export const showDesktopLyricView = async(_options: unknown): Promise<void> => { unavailable() }
export const checkOverlayPermission = async(): Promise<void> => { throw new Error('iOS 不支持跨应用悬浮歌词') }
export const openOverlayPermissionActivity = async(): Promise<void> => { unavailable() }
// Imported Android preferences remain loadable but have no overlay on iOS.
export const hideDesktopLyricView = async() => {}
export const toggleLock = async(_value: boolean) => {}
export const setColor = async(_unplayed: string, _played: string, _shadow: string) => {}
export const setAlpha = async(_value: number) => {}
export const setTextSize = async(_value: number) => {}
export const setShowToggleAnima = async(_value: boolean) => {}
export const setSingleLine = async(_value: boolean) => {}
export const setPosition = async(_x: number, _y: number) => {}
export const setMaxLineNum = async(_value: number) => {}
export const setWidth = async(_value: number) => {}
export const setLyricTextPosition = async(_x: string, _y: string) => {}
export const onPositionChange = (_handler: (position: { x: number, y: number }) => void) => () => {}
