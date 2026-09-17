const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
fs.mkdirSync('build/ios-js', { recursive: true })
const result = spawnSync(process.execPath, ['node_modules/react-native/cli.js', 'bundle', '--platform', 'ios', '--dev', 'false', '--entry-file', 'index.js', '--bundle-output', 'build/ios-js/main.jsbundle', '--assets-dest', 'build/ios-js', '--sourcemap-output', 'build/ios-js/main.jsbundle.map', '--max-workers', '2'], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
const map = JSON.parse(fs.readFileSync('build/ios-js/main.jsbundle.map', 'utf8'))
for (const suffix of ['fs.ios.ts', 'trackPlayer.ios.ts', 'utils.ios.ts', 'lyricDesktop.ios.ts', 'localMediaMetadata.ios.ts', 'DrawerLayoutFixed.ios.tsx']) {
  if (!map.sources.some(path => path.endsWith(suffix))) throw new Error(`iOS adapter missing from bundle: ${suffix}`)
}
for (const suffix of ['src/utils/fs.ts', 'src/utils/nativeModules/lyricDesktop.ts', 'src/components/common/DrawerLayoutFixed.tsx']) {
  if (map.sources.some(path => path.endsWith(suffix))) throw new Error(`Android-only adapter bundled into iOS: ${suffix}`)
}
console.log('Verified iOS adapter selection in Metro source map.')
