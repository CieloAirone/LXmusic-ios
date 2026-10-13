// Bundled only into the XCTest target. Never imported by index.js or shipped in the IPA.
require('../shim')
require('../src/config/globalData')
const React = require('react')
const { AppRegistry, View, NativeModules } = require('react-native')
const probe = NativeModules.LXLyricTestProbe
global.ErrorUtils.setGlobalHandler(error => probe.fail(String(error.stack ?? error)))
const Vertical = require('../src/screens/PlayDetail/Vertical/Lyric').default
const Horizontal = require('../src/screens/PlayDetail/Horizontal/Lyric').default
const { useLrcPlay } = require('../src/plugins/lyric')
const state = require('../src/store/player/state').default
const setting = require('../src/store/setting/state').default
const Player = require('../src/plugins/trackPlayer').default
const nativePlayer = NativeModules.TrackPlayerModule
const initPlayer = require('../src/core/init/player/player').default
const initLyric = require('../src/core/init/player/lyric').default
const registerService = require('../src/plugins/player/service').default
const { getPosition } = require('../src/plugins/player')

function Observer() {
  const { line, text } = useLrcPlay()
  React.useEffect(() => {
    if (!state.musicInfo.id || line < 0) return
    getPosition().then(position => probe.record(line, text, position)).catch(error => probe.fail(String(error)))
  }, [line, text])
  return null
}

function LyricsNativeTest({ audioURL, sending }) {
  React.useEffect(() => {
    let cancelled = false
    async function start() {
      setting.setting['player.isShowBluetoothLyric'] = sending
      setting.setting['player.isSavePlayTime'] = false
      setting.setting['playDetail.isShowLyricProgressSetting'] = false
      await Player.setupPlayer({ autoUpdateMetadata: false, waitForBuffer: true })
      await initPlayer(setting.setting)
      await initLyric(setting.setting)
      registerService()
      state.musicInfo.id = 'lyric-native-fixture'
      state.musicInfo.name = 'Lyric fixture'
      state.playMusicInfo.isTempPlay = true
      global.app_event.musicToggled()
      // Load actual local PCM audio through the native queue; no source/API or cache involved.
      await nativePlayer.add([{ id: state.musicInfo.id, url: audioURL, title: 'Lyric fixture' }], -1)
      // Allow the real asynchronous musicToggled event to finish before lyrics arrive.
      await new Promise(resolve => setTimeout(resolve, 50))
      state.musicInfo.lrc = Array.from({ length: 30 }, (_, i) =>
        `[00:${String(i).padStart(2, '0')}.00]Lyric line ${i}`).join('\n')
      global.app_event.lyricUpdated()
      await new Promise(resolve => setTimeout(resolve, 100))
      if (!cancelled) await Player.play()
    }
    start().catch(error => probe.fail(String(error.stack ?? error)))
    return () => { cancelled = true }
  }, [audioURL, sending])
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'white' }}>
      <Observer />
      <View testID="vertical-lyrics-test" style={{ flex: 1 }}><Vertical /></View>
      <View testID="horizontal-lyrics-test" style={{ flex: 1 }}><Horizontal /></View>
    </View>
  )
}
AppRegistry.registerComponent('LXLyricsNativeTest', () => LyricsNativeTest)
