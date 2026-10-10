// The pinned fork exports these as Promise methods but never resolves them on iOS.
const fs = require('node:fs')
const path = require('node:path')
const root = path.dirname(require.resolve('react-native-track-player/package.json'))
const file = path.join(root, 'ios/RNTrackPlayer/RNTrackPlayer.swift')
let source = fs.readFileSync(file, 'utf8')
for (const [name, call] of [['updateNowPlayingMetadata', 'Metadata.update(for: player, with: metadata)'], ['clearNowPlayingMetadata', 'player.nowPlayingInfoController.clear()']]) {
  const pattern = new RegExp('(public func ' + name + '\\([^]*?\\) \\{)([^]*?)(\\n    \\})')
  const match = source.match(pattern)
  if (!match || !match[2].includes(call)) throw Error('Unsupported TrackPlayer metadata implementation: ' + name)
  if (/\bresolve\(/.test(match[2])) continue
  source = source.replace(pattern, (_, signature, body, close) => signature + body + '\n        resolve(NSNull()) // LX_METADATA_PROMISE\n' + close)
}
fs.writeFileSync(file, source)
