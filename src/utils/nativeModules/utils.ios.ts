import { AppState, Dimensions, Linking, NativeModules, Share } from 'react-native'

const { LXDevice } = NativeModules
// iOS does not allow programmatic application termination. The caller stops audio.
export const exitApp = () => {}
export const getSupportedAbis = async(): Promise<string[]> => ['arm64']
export const installApk = async(_path: string, _authority: string): Promise<void> => {
  throw new Error('iOS 更新请使用原安装渠道，不能安装 APK')
}
export const screenkeepAwake = () => {
  global.lx.isScreenKeepAwake = true
  LXDevice.setKeepAwake(true)
}
export const screenUnkeepAwake = () => {
  global.lx.isScreenKeepAwake = false
  LXDevice.setKeepAwake(false)
}
export const getWIFIIPV4Address = async(): Promise<string> => LXDevice.getWIFIIPV4Address()
export const getDeviceName = async(): Promise<string> => LXDevice.getDeviceName()
// Now Playing transport controls do not require notification permission on iOS.
export const isNotificationsEnabled = async() => true
export const requestNotificationPermission = async() => true
export const shareText = async(_shareTitle: string, title: string, text: string): Promise<void> => {
  await Share.share({ title, message: text })
}
export const getSystemLocales = async(): Promise<string> => LXDevice.getSystemLocales()
export const onScreenStateChange = (handler: (state: 'ON' | 'OFF') => void) => {
  const subscription = AppState.addEventListener('change', state => { handler(state === 'active' ? 'ON' : 'OFF') })
  return () => { subscription.remove() }
}
const physicalSize = () => {
  const { width, height, scale } = Dimensions.get('window')
  return { width: width * scale, height: height * scale }
}
export const getWindowSize = async() => physicalSize()
export const onWindowSizeChange = (handler: (size: { width: number, height: number }) => void) => {
  const subscription = Dimensions.addEventListener('change', () => { handler(physicalSize()) })
  return () => { subscription.remove() }
}
// Android's battery whitelist has no iOS equivalent.
export const isIgnoringBatteryOptimization = async() => true
export const requestIgnoreBatteryOptimization = async() => true
export const openSystemSettings = async() => Linking.openSettings()
