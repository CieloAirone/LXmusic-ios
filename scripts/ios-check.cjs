const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const crypto = require('node:crypto')
const ts = require('typescript')

function sourceRuntime() {
  const events = []
  const timers = new Map()
  const native = {
    __lx_native_call__: (key, action, data) => events.push({ key, action, data: JSON.parse(data) }),
    __lx_native_call__set_timeout: (id, delay) => timers.set(id, delay),
    __lx_native_call__utils_str2b64: value => Buffer.from(value).toString('base64'),
    __lx_native_call__utils_b642buf: value => JSON.stringify([...Buffer.from(value, 'base64')]),
    __lx_native_call__utils_buf2b64: value => Buffer.from(JSON.parse(value)).toString('base64'),
    __lx_native_call__utils_buf2str: value => Buffer.from(JSON.parse(value)).toString('utf8'),
    __lx_native_call__utils_str2md5: value => crypto.createHash('md5').update(decodeURIComponent(value)).digest('hex'),
    __lx_native_call__utils_aes_encrypt: (data, key, iv, mode) => {
      const cipher = crypto.createCipheriv(mode === 'AES' ? 'aes-128-ecb' : 'aes-128-cbc', Buffer.from(key, 'base64'), mode === 'AES' ? null : Buffer.from(iv, 'base64'))
      return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('base64')
    },
    __lx_native_call__utils_rsa_encrypt: () => '',
    console: { log() {}, warn() {}, error() {} },
  }
  // Define context-native wrappers: the upstream runtime freezes global function prototypes.
  const context = vm.createContext({})
  for (const [name, value] of Object.entries(native)) {
    if (typeof value !== 'function') continue
    context.__host = value
    vm.runInContext(`globalThis[${JSON.stringify(name)}] = ((host) => (...args) => host(...args))(__host)`, context)
  }
  delete context.__host
  vm.runInContext('globalThis.console = { log() {}, warn() {}, error() {} }', context)
  vm.runInContext(fs.readFileSync('ios/LXPlatform/Resources/user-api-preload.js', 'utf8'), context)
  vm.runInContext("lx_setup('session-key', 'fixture', '测试源', '', '1', '', '', '')", context)
  return { context, events, timers, run: code => vm.runInContext(code, context) }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
test('source runtime negotiates supported quality and round-trips requests', async() => {
  const env = sourceRuntime()
  env.run("lx.on(lx.EVENT_NAMES.request, async ({info}) => 'https://example.com/' + info.type); lx.send(lx.EVENT_NAMES.inited, {sources:{kw:{type:'music', actions:['musicUrl'], qualitys:['128k','invalid']}}})")
  await tick()
  assert.deepEqual(env.events[0].data.info.sources.kw.qualitys, ['128k'])
  env.context.__lx_native__('session-key', 'request', JSON.stringify({ requestKey: 'r1', data: {source:'kw', action:'musicUrl', info:{type:'128k'}} }))
  await tick()
  const response = env.events.find(event => event.action === 'response')
  assert.equal(response.data.status, true)
  assert.equal(response.data.result.data.url, 'https://example.com/128k')
  assert.equal(env.context.__lx_native__('wrong-key', 'request', '{}'), 'Invalid key')
})
test('source runtime preserves every byte and Unicode in buffer conversions', () => {
  const env = sourceRuntime()
  const base64 = Buffer.from(Array.from({length:256}, (_, i) => i)).toString('base64')
  assert.equal(env.run(`lx.utils.buffer.bufToString(lx.utils.buffer.from('${base64}', 'base64'), 'base64')`), base64)
  assert.equal(env.run("lx.utils.buffer.bufToString(lx.utils.buffer.from('音乐 🎵'), 'utf8')"), '音乐 🎵')
  assert.equal(env.run("lx.utils.crypto.md5('a+b 音乐')"), crypto.createHash('md5').update('a+b 音乐').digest('hex'))
})
test('source runtime timer cancellation, request abort and invalid result handling', async() => {
  const env = sourceRuntime()
  const id = env.run("setTimeout(() => console.log('cancelled'), 10)")
  env.run(`clearTimeout(${id})`)
  env.context.__lx_native__('session-key', '__set_timeout__', JSON.stringify(id))
  env.run("lx.request('https://example.com', {}, () => {})()")
  assert.equal(env.events.at(-1).action, 'cancelRequest')
  env.run("lx.on(lx.EVENT_NAMES.request, async () => 'file:///private/data')")
  env.context.__lx_native__('session-key', 'request', JSON.stringify({requestKey:'bad',data:{source:'kw',action:'musicUrl',info:{type:'128k'}}}))
  await tick()
  assert.equal(env.events.at(-1).data.status, false)
  assert.throws(() => env.run("eval('1')"), /not available/)
})
function loadTS(file, modules, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020, esModuleInterop:true}}).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => { if (!(name in modules)) throw new Error('Unexpected import: ' + name); return modules[name] }, console, Buffer, ...globals })
  return exports
}
test('iOS player metadata bridge uses native argument count and keeps title fields', async() => {
  const calls = []
  const player = loadTS('src/plugins/trackPlayer.ios.ts', {
    'react-native-track-player': { setupPlayer: async() => {}, add: async tracks => calls.push(['add', tracks]) },
    'react-native': {NativeModules:{TrackPlayerModule:{updateNowPlayingMetadata: async(...args) => calls.push(args)}}},
    './player/ios/cache': {configureCache(){}, cachedURL: async url => url, cacheURL: async() => {}},
  }).default
  await player.updateNowPlayingMetadata({title:'歌曲',artist:'歌手',album:'专辑'}, true)
  await player.updateNowPlayingTitles({title:'歌词'})
  assert.equal(calls[0].length, 1)
  assert.equal(calls[1][0].artist, '歌手')
  assert.equal(calls[1][0].title, '歌词')
  await player.add({id:'local',url:'/Documents/音乐.mp3',userAgent:'LX',title:'a',artist:'b'})
  assert.equal(calls[2][1][0].url, 'file:///Documents/音乐.mp3')
  assert.equal(calls[2][1][0].headers['User-Agent'], 'LX')
})
test('iOS gzip is compatible with standard gzip and preserves binary backups', async() => {
  const file = loadTS('src/utils/fs.ios.ts', {
    'react-native-fs': {CachesDirectoryPath:'/cache',DocumentDirectoryPath:'/documents',LibraryDirectoryPath:'/library'},
    'react-native': {NativeModules:{}}, '@craftzdog/react-native-buffer':{Buffer}, pako:require('pako'),
  })
  const text = '歌单 🎵 '.repeat(500)
  const compressed = await file.gzipString(text)
  assert.equal(require('node:zlib').gunzipSync(Buffer.from(compressed,'base64')).toString(), text)
  assert.equal(await file.unGzipString(compressed), text)
  const bytes = Buffer.from([0,255,128,1,2]).toString('base64')
  assert.equal(await file.unGzipString(await file.gzipString(bytes, 'base64'), 'base64'), bytes)
})
test('audio cache deduplicates requests and clearing cancels pending downloads', async() => {
  const storage = new Map()
  let downloads = 0
  let finish
  let fail
  const stopped = []
  const rnfs = {
    CachesDirectoryPath:'/cache', exists:async path => storage.has(path), mkdir:async path => storage.set(path, 0),
    readDir:async() => [], moveFile:async(from,to) => {storage.set(to,storage.get(from));storage.delete(from)},
    unlink:async path => { for (const key of storage.keys()) if (key.startsWith(path)) storage.delete(key) },
    downloadFile: options => {
      downloads++
      storage.set(options.toFile, 12)
      return {jobId:downloads,promise:new Promise((resolve,reject) => {finish=resolve;fail=reject})}
    },
    stopDownload:id => { stopped.push(id); fail(new Error('cancelled')) }, completeHandlerIOS() {},
  }
  const cache = loadTS('src/plugins/player/ios/cache.ts', {'react-native-fs':rnfs,'react-native-quick-md5':{stringMd5:()=> 'test'}})
  const first = cache.cacheURL('https://example.com/a').catch(error => error)
  const second = cache.cacheURL('https://example.com/a').catch(error => error)
  await tick()
  assert.equal(downloads,1)
  const clearing = cache.clearCache()
  await Promise.all([first,second,clearing])
  assert.deepEqual(stopped,[1])
  assert.equal(await cache.isCached('https://example.com/a'),false)
  const third = cache.cacheURL('https://example.com/a')
  await tick()
  finish({statusCode:200,bytesWritten:12})
  await third
  assert.equal(await cache.isCached('https://example.com/a'),true)
})
test('generated native key strings form PEM accepted by the sync server', async() => {
  const fixture = JSON.parse(fs.readFileSync('ios/LxMusicMobileTests/Fixtures/crypto-fixtures.json','utf8'))
  const api = loadTS('src/utils/nativeModules/crypto.ts', {'react-native':{NativeModules:{CryptoModule:{generateRsaKey:async() => ({publicKey:fixture.publicKey,privateKey:fixture.privateKey})}}}})
  const keys = await api.generateRsaKey()
  assert.equal(crypto.createPublicKey(keys.publicKey).asymmetricKeyType, 'rsa')
  assert.equal(crypto.createPrivateKey(keys.privateKey).asymmetricKeyType, 'rsa')
})
test('sync authentication encodes Unicode device names as UTF-8 for the server', () => {
  const sync = loadTS('src/plugins/sync/utils.ts', {
    '@craftzdog/react-native-buffer': {Buffer},
    '@/utils/nativeModules/crypto': {
      AES_MODE: {ECB_128_NoPadding: 'AES'}, RSA_PADDING: {},
      aesEncryptSync(data, key, iv, mode) {
        assert.equal(mode, 'AES')
        const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(key, 'base64'), null)
        return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('base64')
      },
    },
  })
  const key = Buffer.from('0123456789abcdef').toString('base64')
  for (const text of ['lx-music connect', 'lx-music auth::小明的 iPhone 🎵', 'lx-music auth::\npublic-key\n小明的 iPhone 🎵\nlx_music_mobile']) {
    const ciphertext = sync.aesEncrypt(text, key)
    const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(key, 'base64'), null)
    assert.equal(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8'), text)
  }
})
test('iOS Buffer works without JSI Base64 globals, including binary slices and gzip', async() => {
  const adapter = loadTS('src/utils/base64.ios.js', {'base64-js':require('base64-js')})
  const exports = {}
  vm.runInNewContext(fs.readFileSync(require.resolve('@craftzdog/react-native-buffer'), 'utf8'), {
    exports, navigator:{product:'ReactNative'}, Uint8Array, ArrayBuffer,
    require: name => name === 'react-native-quick-base64' ? adapter : require(name),
  })
  const MobileBuffer = exports.Buffer
  const bytes = MobileBuffer.from(Array.from({length:256}, (_, i) => i))
  const slice = bytes.subarray(7, 233)
  assert.equal(slice.toString('base64'), Buffer.from(slice).toString('base64'))
  const text = '音乐 🎵 '.repeat(500)
  assert.equal(MobileBuffer.from(MobileBuffer.from(text).toString('base64'), 'base64').toString(), text)
  const file = loadTS('src/utils/fs.ios.ts', {
    'react-native-fs': {}, 'react-native':{NativeModules:{}},
    '@craftzdog/react-native-buffer':{Buffer:MobileBuffer}, pako:require('pako'),
  })
  assert.equal(await file.unGzipString(await file.gzipString(text)), text)
  assert.equal(adapter.atob(adapter.btoa('\x00\xff')), '\x00\xff')
})

test('startup dimensions keep playlist drawer width and row height nonzero before async init', () => {
  for (const size of [{width:0,height:0}, {width:390,height:844}]) {
    const ratio = loadTS('src/utils/pixelRatio.ts', {
      'react-native': {
        Dimensions: {get: () => ({width:390,height:844})},
        PixelRatio: {get: () => 3, getFontScale: () => 1, getPixelSizeForLayoutSize: value => value * 3},
      },
      './windowSizeTools': {windowSizeTools:{getSize: () => size}},
    }, {global:{lx:{fontSize:1}}})
    assert.equal(ratio.scaleSizeW(400), 413)
    assert.equal(ratio.scaleSizeH(40), 41)
    assert.ok(ratio.getTextSize(14) > 0)
  }
})
test('actual iOS playlist container styles allocate a visible native scroll viewport', async() => {
  const {default: Yoga} = await import('yoga-layout')
  let styles
  const source = ts.transpileModule(fs.readFileSync('src/screens/Home/Views/Mylist/MyList/List.tsx', 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX},
  }).outputText
  vm.runInNewContext(source, {
    exports:{}, require(name) {
      if (name === 'react') return {memo: component => component}
      if (name === 'react-native') return {Platform:{OS:'ios'}}
      if (name === '@/utils/tools') return {createStyle: value => {styles = value; return value}}
      if (name === '@/utils/pixelRatio') return {scaleSizeH: value => value}
      return {}
    },
  })
  const parent = Yoga.Node.create()
  const scroll = Yoga.Node.create()
  try {
    parent.setWidth(320); parent.setHeight(600)
    if (styles.container.flex != null) scroll.setFlex(styles.container.flex)
    scroll.setFlexGrow(styles.container.flexGrow)
    scroll.setFlexShrink(styles.container.flexShrink)
    scroll.setMeasureFunc(() => ({width:0,height:0}))
    parent.insertChild(scroll, 0)
    parent.calculateLayout(320, 600, Yoga.DIRECTION_LTR)
    assert.equal(scroll.getComputedHeight(), 600)
    assert.equal(scroll.getComputedWidth(), 320)
  } finally { parent.freeRecursive() }
})
test('iOS playback continues with original URL when optional cache lookup fails', async() => {
  let added
  const player = loadTS('src/plugins/trackPlayer.ios.ts', {
    'react-native-track-player': {add: async tracks => {added=tracks}},
    'react-native': {NativeModules:{}},
    './player/ios/cache': {cachedURL:async() => {throw Error('disk unavailable')},cacheURL:async()=>{}},
  }).default
  await player.add({id:'music',url:'https://example.com/audio.mp3',userAgent:'LX',headers:{Referer:'https://example.com'}})
  assert.equal(added[0].url,'https://example.com/audio.mp3')
  assert.equal(added[0].headers.Referer,'https://example.com')
  assert.equal(added[0].headers['User-Agent'],'LX')
})
test('track identity comes from native queue even before JS queue bookkeeping catches up', async() => {
  let index = 0
  const api = loadTS('src/plugins/player/playList.ts', {
    '@/plugins/trackPlayer':{getCurrentTrack:async()=>index,getTrack:async()=>({id:'real-song',url:'https://example.com/a.mp3'})},
    'react-native-background-timer':{}, '@/config':{defaultUrl:1},
    '@/store/setting/state':{setting:{}}, '@/store/player/state':{}, '@/utils/log':{log:{}},
  })
  assert.equal(await api.getCurrentTrackId(), 'real-song')
  assert.equal((await api.getCurrentTrack()).id, 'real-song')
  index = null
  assert.equal(await api.getCurrentTrackId(), undefined)
})
test('lyric timers ignore callbacks delivered after clear or a new song starts', () => {
  const source = fs.readFileSync(require.resolve('lrc-file-parser'), 'utf8')
  const start = source.indexOf('const timeoutTools = {', source.indexOf('const noop'))
  const end = source.indexOf('\nconst t_rxp_1', start)
  const frames = [], timers = []
  let now = 0, calls = 0
  const context = {getNow:()=>now, noop(){}, window:{requestAnimationFrame:fn=>(frames.push(fn),frames.length),cancelAnimationFrame(){},clearTimeout(){}},setTimeout:fn=>(timers.push(fn),timers.length)}
  vm.runInNewContext(source.slice(start,end)+';globalThis.timer=Object.create(timeoutTools)',context)
  const timer = context.timer
  timer.start(()=>calls++)
  timer.clear()
  assert.doesNotThrow(()=>frames.shift()())
  timer.start(()=>{throw Error('stale song')})
  timer.start(()=>calls++)
  frames.shift()()
  assert.equal(calls,0)
  frames.shift()()
  assert.equal(calls,1)
  timer.start(()=>calls++,1000)
  frames.shift()()
  timer.clear();now=2000
  timers.shift()()
  assert.equal(frames.length,0)
  assert.equal(calls,1)
})
