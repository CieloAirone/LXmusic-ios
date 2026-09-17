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
function loadTS(file, modules) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020, esModuleInterop:true}}).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => { if (!(name in modules)) throw new Error('Unexpected import: ' + name); return modules[name] }, console, Buffer })
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
