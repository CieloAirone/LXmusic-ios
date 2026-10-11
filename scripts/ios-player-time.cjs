const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const tick = () => new Promise(resolve => setImmediate(resolve))
function load(file, modules = {}, globals = {}) {
  const source = fs.readFileSync(file, 'utf8')
  const code = /\.tsx?$/.test(file) ? ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText : source
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (!(name in modules)) throw Error('Unexpected import ' + name + ' in ' + file)
    return modules[name]
  }, console, Buffer, ...globals }, { filename: file })
  return module.exports
}
function emitter() {
  const listeners = new Map()
  return new Proxy({
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
    off(name, fn) { listeners.get(name)?.delete(fn) },
  }, { get(target, key) { return target[key] ?? ((...args) => { for (const fn of listeners.get(key) ?? []) fn(...args) }) } })
}
function environment(platform = 'ios') {
  const seconds = { position: 42, duration: 180, buffered: 75 }
  let nativeState = 'playing'
  const seekCalls = []
  const native = {
    STATE_PLAYING: 'playing', STATE_PAUSED: 'paused', STATE_NONE: 'idle',
    setupPlayer: async() => {}, add: async() => {},
    getPosition: async() => seconds.position * (platform === 'android' ? 1000 : 1),
    getDuration: async() => seconds.duration * (platform === 'android' ? 1000 : 1),
    getBufferedPosition: async() => seconds.buffered * (platform === 'android' ? 1000 : 1),
    getState: async() => nativeState,
    seekTo: async value => { seekCalls.push(value); seconds.position = value },
    updateNowPlayingMetadata: async() => {},
  }
  const rn = { NativeModules: { TrackPlayerModule: native }, Platform: { OS: platform },
    NativeEventEmitter: class { addListener() { return { remove() {} } } }, DeviceEventEmitter: {} }
  const root = path.dirname(require.resolve('react-native-track-player/package.json'))
  const interfaces = load(path.join(root, 'lib/interfaces.js'), { 'react-native': rn })
  const upstream = load(path.join(root, 'lib/trackPlayer.js'), {
    'react-native': rn, './interfaces': interfaces,
    'react-native/Libraries/Image/resolveAssetSource': value => value,
  }).default
  const player = platform === 'ios' ? load(process.env.LX_IOS_ADAPTER ?? 'src/plugins/trackPlayer.ios.ts', {
    'react-native-track-player': { __esModule: true, default: upstream, ...interfaces }, 'react-native': rn,
    './player/ios/cache': { configureCache() {}, cachedURL: async url => url, cacheURL: async() => {} },
  }).default : upstream
  const common = load('src/utils/common.ts')
  const state = load('src/store/player/state.ts').default
  const global = { app_event: emitter(), state_event: emitter() }
  const action = load('src/store/player/action.ts', { '@/utils': common, './state': state }, { global }).default
  const progress = load('src/core/player/progress.ts', { '@/store/player/action': action })
  const timers = new Map()
  let timerId = 0
  const timer = { setInterval(fn) { const id = ++timerId; timers.set(id, fn); return id }, clearInterval(id) { timers.delete(id) } }
  const setting = { setting: { 'player.playbackRate': 1, 'player.isSavePlayTime': false } }
  let clock = 0
  const frames = new Map()
  let frameId = 0
  const window = { requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id }, cancelAnimationFrame(id) { frames.delete(id) }, clearTimeout(id) { frames.delete(id) } }
  const lrcRoot = path.dirname(require.resolve('lrc-file-parser/package.json'))
  const Parser = load(path.join(lrcRoot, 'dist/lrc-file-parser.js'), {}, {
    window, performance: { now: () => clock },
    setTimeout(fn) { const id = ++frameId; frames.set(id, fn); return id },
  })
  let line = null
  const lyricPlugin = load('src/plugins/lyric.ts', {
    react: { useEffect: fn => fn(), useState: initial => [initial, value => { line = value }] },
    'lrc-file-parser': Parser,
  })
  const lyric = load('src/core/lyric.ts', {
    '@/plugins/lyric': lyricPlugin, '@/plugins/player': player,
    '@/store/player/state': state, '@/store/setting/state': setting,
    '@/plugins/player/utils': { updateNowPlayingTitles: async() => {} },
    '@/core/desktopLyric': { setDesktopLyric: async() => {}, playDesktopLyric: async() => {}, pauseDesktopLyric: async() => {} },
  })
  const init = load('src/core/init/player/playProgress.ts', {
    '@/core/list': {}, '@/core/player/progress': progress, '@/plugins/player': { ...player, setCurrentTime: player.seekTo },
    '@/plugins/trackPlayer': { __esModule: true, default: player, State: interfaces.State },
    '@/utils/common': common, '@/utils/data': { savePlayInfo: async() => {} },
    '@/utils/tools': { throttleBackgroundTimer: fn => fn }, 'react-native-background-timer': timer,
    '@/store/player/state': state, '@/store/setting/state': setting, '@/core/lyric': lyric,
    '@/utils/nativeModules/utils': { onScreenStateChange() {} },
    'react-native': { AppState: { currentState: 'active', addEventListener() {} } },
  }, { global }).default
  return { player, seconds, state, global, init, lyric, lyricPlugin, seekCalls,
    line: () => line, setNativeState: value => { nativeState = value },
    async poll() { for (const fn of [...timers.values()]) fn(); await tick(); await tick() },
    advanceLyrics(ms) { clock += ms; for (const [id, fn] of [...frames]) { frames.delete(id); fn() } },
  }
}
test('iOS seconds survive dependency boundary into time labels and buffer', async() => {
  const e = environment(); await e.player.setupPlayer()
  e.state.musicInfo.id = 'fixture'; e.state.isPlay = true
  e.init(); e.global.app_event.play(); await tick()
  assert.equal(e.state.progress.nowPlayTimeStr, '00:42')
  assert.equal(e.state.progress.maxPlayTimeStr, '03:00')
  assert.equal(await e.player.getBufferedPosition(), 75)
  e.seconds.position = 43.5; await e.poll()
  assert.equal(e.state.progress.nowPlayTimeStr, '00:43')
  assert.equal(e.state.progress.nowPlayTime, 43.5)
  e.seconds.position = 0; await e.poll()
  assert.equal(e.state.progress.nowPlayTimeStr, '00:00')
  e.global.app_event.setProgress(60); await tick()
  assert.deepEqual(e.seekCalls, [60], 'seeking must keep seconds')
  e.global.app_event.pause(); e.setNativeState('paused'); e.seconds.position = 61; await e.poll()
  assert.equal(e.state.progress.nowPlayTime, 60, 'pause must not resurrect progress updates')
  e.setNativeState('playing'); e.global.app_event.play(); await tick()
  assert.equal(e.state.progress.nowPlayTime, 61)
})
test('native position selects correct lyric; real parser advances lines', async() => {
  const e = environment(); await e.player.setupPlayer(); await e.lyric.init()
  e.lyricPlugin.useLrcPlay()
  e.state.musicInfo.id = 'fixture'; e.state.isPlay = true
  e.state.musicInfo.lrc = '[00:00.00]start\n[00:40.00]forty\n[00:45.00]forty-five\n[01:20.00]eighty\n[02:59.00]end'
  await e.lyric.setLyric(); await tick()
  assert.equal(e.line().text, 'forty', '42 seconds must not become 42 milliseconds')
  e.advanceLyrics(4000)
  assert.equal(e.line().text, 'forty-five', 'the real parser must advance with its timer')
  e.lyric.pause(); e.seconds.position = 80; e.lyric.play(); await tick()
  assert.equal(e.line().text, 'eighty')
  e.lyric.pause(); await e.player.seekTo(0); e.lyric.play(); await tick()
  assert.equal(e.line().text, 'start')
})
test('Android millisecond bridge retains its seconds conversion', async() => {
  const e = environment('android'); await e.player.setupPlayer()
  assert.equal(await e.player.getPosition(), 42)
  assert.equal(await e.player.getDuration(), 180)
  assert.equal(await e.player.getBufferedPosition(), 75)
})
