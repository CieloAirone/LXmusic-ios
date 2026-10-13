// Real app events, core lyric code, BOTH iOS parsers and React lyric pages.
// Only native APIs/views and the clock are controlled here; this is not device UI proof.
process.env.NODE_ENV = 'test'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const root = path.resolve(__dirname, '..')
const tick = () => new Promise(resolve => setImmediate(resolve))
const fixture = label => Array.from({ length: 35 }, (_, i) =>
  `[${String(Math.floor(i * 2 / 60)).padStart(2, '0')}:${String(i * 2 % 60).padStart(2, '0')}.00]${label} ${i}`).join('\n')

function load(file, modules, globals) {
  const source = fs.readFileSync(path.resolve(root, file), 'utf8')
  const code = /\.tsx?$/.test(file) ? ts.transpileModule(source, {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText : source.replace(/export \{ Lyric as default \};?/, 'module.exports = Lyric;')
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, React, console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (!(name in modules)) throw Error(`Unexpected import ${name} in ${file}`)
      return modules[name]
    }, ...globals }, { filename: file })
  return module.exports
}

async function environment(orientation, sending = false) {
  let now = 0, nextId = 0, nativeState = 'paused', position = 0, start = 0
  const timers = new Map(), trace = [], nativeListeners = new Map(), metadata = []
  const schedule = (fn, delay = 0, interval = 0) => {
    const id = ++nextId
    timers.set(id, { fn, time: now + delay, interval })
    return id
  }
  const cancel = id => timers.delete(id)
  const globals = {
    setTimeout: schedule, clearTimeout: cancel, setImmediate,
    requestAnimationFrame: fn => schedule(fn, 16),
    performance: { now: () => now },
  }
  globals.window = { requestAnimationFrame: globals.requestAnimationFrame, cancelAnimationFrame: cancel, clearTimeout: cancel }
  const timer = { setInterval: (fn, ms) => schedule(fn, ms, ms), clearInterval: cancel }
  const Parser = load(process.env.LX_LYRIC_PARSER ?? require.resolve('lrc-file-parser'), {}, globals)
  const plugin = load('src/plugins/lyric.ts', { react: React, 'lrc-file-parser': Parser }, globals)
  // Deliberately share the SAME Parser module, as Metro does in the app.
  const nativeLyric = load('src/utils/nativeModules/lyricDesktop.ios.ts', {
    'lrc-file-parser': Parser, 'react-native': { Alert: { alert() {} } },
  }, globals)
  const common = load('src/utils/common.ts', {}, globals)
  const state = load('src/store/player/state.ts', {}, globals).default
  const Event = load('src/event/Event.ts', {}, globals).default
  const AppEvent = load('src/event/appEvent.ts', { './Event': Event, '@/core/common': {}, '@/store/common/state': {} }, globals).AppEvent
  const StateEvent = load('src/event/stateEvent.ts', { './Event': Event }, globals).StateEvent
  const global = { app_event: new AppEvent(), state_event: new StateEvent(), lx: { playerTrackId: '', playerStatus: {} } }
  globals.global = global
  const action = load('src/store/player/action.ts', { '@/utils': common, './state': state }, globals).default
  const progress = load('src/core/player/progress.ts', { '@/store/player/action': action }, globals)
  const setting = { setting: { 'player.playbackRate': 1, 'player.isShowBluetoothLyric': sending } }
  const player = {
    getPosition: async() => position + (nativeState === 'playing' ? (now - start) / 1000 : 0),
    getDuration: async() => 180, getState: async() => nativeState,
    setCurrentTime: async value => { position = value; start = now },
    addEventListener: (name, fn) => { nativeListeners.set(name, fn) },
    registerPlaybackService: factory => { player.register = factory() },
  }
  const utils = { updateNowPlayingTitles: async value => { metadata.push(value) } }
  const desktop = load('src/core/desktopLyric.ts', {
    '@/utils/nativeModules/lyricDesktop': nativeLyric, '@/store/setting/state': setting,
    '@/store/player/state': state, '@/utils/simplify-chinese-main': { tranditionalize: value => value },
    '@/plugins/player': player,
  }, globals)
  const core = load('src/core/lyric.ts', {
    '@/plugins/lyric': plugin, '@/core/desktopLyric': desktop, '@/plugins/player': player,
    '@/store/player/state': state, '@/store/setting/state': setting, '@/plugins/player/utils': utils,
  }, globals)
  await load('src/core/init/player/lyric.ts', {
    '@/core/lyric': core, '@/core/common': {}, '@/core/desktopLyric': desktop,
    '@/store/player/state': state, '@/plugins/player/utils': utils,
    '@/core/player/playInfo': { setLastLyric() {} },
  }, globals).default(setting.setting)
  load('src/core/init/player/playProgress.ts', {
    '@/core/list': {}, '@/core/player/progress': progress, '@/plugins/player': player,
    '@/plugins/trackPlayer': { __esModule: true, default: player, State: { Playing: 'playing' } },
    '@/utils/common': common, '@/utils/data': { savePlayInfo: async() => {} },
    '@/utils/tools': { throttleBackgroundTimer: fn => fn }, 'react-native-background-timer': timer,
    '@/store/player/state': state, '@/store/setting/state': setting, '@/core/lyric': core,
    '@/utils/nativeModules/utils': { onScreenStateChange() {} },
    'react-native': { AppState: { addEventListener() {} } },
  }, globals).default()
  load('src/plugins/player/service.ts', {
    '@/utils/log': { log: { error() {} } },
    '@/plugins/trackPlayer': { __esModule: true, default: player,
      State: { Playing: 'playing', Paused: 'paused' },
      Event: Object.fromEntries(['PlaybackState', 'PlaybackTrackChanged', 'PlaybackError', 'RemotePlay', 'RemotePause',
        'RemoteNext', 'RemotePrevious', 'RemoteStop', 'RemoteSeek'].map(k => [k, k])) },
    './utils': { isTempId: () => false }, '@/core/common': {},
    './playList': { getCurrentTrackId: async() => state.musicInfo.id, isTempTrack: () => false },
    '@/core/player/player': {},
  }, globals).default()
  await player.register()
  const calls = []
  class FlatList extends React.Component {
    scrollToOffset(value) {
      assert(Number.isFinite(value.offset), 'native scroll offset must be finite')
      calls.push({ kind: 'offset', ...value })
    }
    scrollToIndex(value) {
      assert(value.index >= 0 && value.index < this.props.data.length, 'native index must exist')
      calls.push({ kind: 'index', ...value })
    }
    render() {
      return React.createElement('FlatList', {}, this.props.ListHeaderComponent,
        this.props.data.map((item, index) => React.createElement(React.Fragment, { key: index }, this.props.renderItem({ item, index }))))
    }
  }
  const scroll = load('src/utils/scroll.ts', {}, globals)
  const Component = load(`src/screens/PlayDetail/${orientation}/Lyric.tsx`, {
    react: React, 'react-native': { View: 'View', FlatList }, '@/plugins/lyric': plugin,
    '@/utils/tools': { createStyle: value => value }, '@/store/theme/hook': { useTheme: () => ({ 'c-primary': 'red' }) },
    '@/store/setting/hook': { useSettingValue: key => key.includes('lrcFontSize') ? 180 : key.includes('align') ? 'center' : false },
    '@/components/common/Text': { AnimatedColorText: 'Text' }, '@/utils/pixelRatio': { setSpText: value => value },
    '@/store/player/state': state, '@/utils/scroll': scroll, '../components/PlayLine': () => null,
  }, globals).default
  let currentLine, renderer
  const Observer = () => {
    currentLine = plugin.useLrcPlay()
    React.useEffect(() => { trace.push({ ms: now, ...currentLine }) }, [currentLine])
    return null
  }
  act(() => { renderer = Renderer.create(React.createElement(React.Fragment, {}, React.createElement(Observer), React.createElement(Component))) })
  const flush = async() => { for (let i = 0; i < 4; i++) await tick() }
  const run = async fn => { await act(async() => { await fn(); await flush() }) }
  const advance = async ms => {
    const end = now + ms
    while (now < end) {
      const stepEnd = Math.min(end, now + 100)
      await run(() => {
        for (let count = 0; count < 10000; count++) {
          const pending = [...timers].filter(([, value]) => value.time <= stepEnd).sort((a, b) => a[1].time - b[1].time)[0]
          if (!pending) { now = stepEnd; return }
          const [id, task] = pending
          now = task.time
          if (task.interval) task.time += task.interval
          else timers.delete(id)
          task.fn()
        }
        throw Error('Timer loop')
      })
    }
  }
  const measure = () => {
    act(() => {
      for (const view of renderer.root.findAllByType('View')) {
        view.props.onLayout?.({ nativeEvent: { layout: { height: view.props.children ? 40 : 300, width: 300 } } })
      }
      renderer.root.findByType(FlatList).props.onScroll({ nativeEvent: {
        contentOffset: { y: 0 }, contentSize: { height: 2200 }, layoutMeasurement: { height: 300 },
      } })
    })
  }
  return {
    core, nativeLyric, state, global, calls, trace, metadata, run, advance, measure,
    line: () => currentLine,
    list: () => renderer.root.findByType(FlatList),
    async playback(value) {
      await run(async() => {
        position = await player.getPosition(); start = now; nativeState = value; state.isPlay = value === 'playing'
        await nativeListeners.get('PlaybackState')({ state: value })
      })
    },
    async song(id) {
      await run(() => {
        state.musicInfo.id = id; state.musicInfo.lrc = null; position = 0; start = now
        global.app_event.musicToggled()
      })
    },
    async lyrics(label = 'song') {
      await run(() => {
        state.musicInfo.lrc = fixture(label)
        global.app_event.lyricUpdated()
      })
      measure()
    },
    async close() { await run(() => { core.pause(); renderer.unmount() }); timers.clear() },
  }
}

for (const orientation of ['Vertical', 'Horizontal']) {
  for (const sending of [false, true]) {
    test(`${orientation}: foreground lyrics advance while iOS lock-screen lyrics are ${sending ? 'on' : 'off'}`, async t => {
      const e = await environment(orientation, sending)
      t.after(() => e.close())
      await e.song('one'); await e.lyrics(); await e.playback('playing'); await e.advance(6500)
      assert.equal(e.state.progress.nowPlayTimeStr, '00:06', 'audio clock still works')
      assert.equal(e.line().line, 3, 'foreground parser must keep emitting after the second parser starts')
      assert(e.trace.some(v => v.line === 1) && e.trace.some(v => v.line === 2))
      await e.advance(1000) // The page deliberately waits 600 ms, then animates for 600 ms.
      assert(e.calls.filter(v => v.kind === 'offset' && v.offset > 300).length > 2, 'page must animate beyond initial positioning')
      if (sending) assert(e.metadata.some(v => v.title === 'song 3'), 'lock-screen lyric still advances too')
    })
  }
  test(`${orientation}: play-before-lyrics, track change, pause/resume and drag recovery`, async t => {
    const e = await environment(orientation)
    t.after(() => e.close())
    await e.playback('playing'); await e.song('late'); await e.advance(1200); await e.lyrics('late')
    await e.advance(5300)
    assert.equal(e.line().line, 3, 'late lyric load must start at native position')
    await e.playback('paused'); await e.advance(800)
    const pausedLine = e.line().line, pausedCalls = e.calls.length
    await e.advance(3500)
    assert.equal(e.line().line, pausedLine); assert.equal(e.calls.length, pausedCalls)
    await e.playback('playing'); await e.advance(2500)
    assert(e.line().line > pausedLine, 'resume must restart both parsers')
    await e.run(() => e.list().props.onScrollBeginDrag())
    const dragCalls = e.calls.length
    await e.advance(2300)
    assert.equal(e.calls.length, dragCalls, 'manual dragging must hold auto-scroll')
    await e.run(() => e.list().props.onScrollEndDrag()); await e.advance(4200)
    assert(e.calls.length > dragCalls, 'auto-scroll must resume after drag')
    await e.song('next'); await e.lyrics('next'); await e.playback('playing'); await e.advance(6500)
    assert.equal(e.line().text, 'next 3', 'new track must replace old lyrics and continue')
  })
  test(`${orientation}: lock-screen pause/reload/rate changes cannot stop foreground lyrics`, async t => {
    const e = await environment(orientation, true)
    t.after(() => e.close())
    await e.song('one'); await e.lyrics(); await e.playback('playing'); await e.advance(2500)
    await e.run(() => e.nativeLyric.pause()); await e.advance(2000)
    assert.equal(e.line().line, 2)
    await e.run(async() => { await e.nativeLyric.toggleTranslation(true); await e.nativeLyric.play(4500) })
    await e.advance(2000); assert.equal(e.line().line, 3)
    await e.run(() => e.nativeLyric.setPlaybackRate(2)); await e.advance(2000)
    assert.equal(e.line().line, 4)
  })
}

test('both distributed parser entrypoints isolate simultaneous instances', () => {
  for (const name of ['lrc-file-parser.js', 'lrc-file-parser.esm.js']) {
    const frames = new Map(), timers = new Map(); let id = 0, now = 0
    const window = { requestAnimationFrame: fn => { frames.set(++id, fn); return id }, cancelAnimationFrame: id => frames.delete(id), clearTimeout: id => timers.delete(id) }
    const Parser = load(path.join(path.dirname(require.resolve('lrc-file-parser')), name), {}, {
      window, performance: { now: () => now }, setTimeout: fn => { timers.set(++id, fn); return id },
    })
    const first = [], second = []
    const a = new Parser({ lyric: fixture('A'), onPlay: line => first.push(line) })
    const b = new Parser({ lyric: fixture('B'), onPlay: line => second.push(line) })
    a.play(0); b.play(0)
    now = 2500
    for (const [key, fn] of [...frames]) { frames.delete(key); fn() }
    assert.equal(first.at(-1), 1, name + ': first parser was cancelled by second')
    assert.equal(second.at(-1), 1)
    b.pause(); now = 4500
    for (const [key, fn] of [...timers]) { timers.delete(key); fn() }
    for (const [key, fn] of [...frames]) { frames.delete(key); fn() }
    assert.equal(first.at(-1), 2, name + ': pausing second cancelled first')
    a.pause()
  }
})
