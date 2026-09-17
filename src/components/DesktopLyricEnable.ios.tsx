import { forwardRef, useImperativeHandle } from 'react'
import { Alert } from 'react-native'
export interface DesktopLyricEnableType { setEnabled: (enabled: boolean) => void }
export default forwardRef<DesktopLyricEnableType, {}>((_props, ref) => {
  useImperativeHandle(ref, () => ({
    setEnabled(enabled) {
      if (enabled) Alert.alert('桌面歌词', 'iOS 不支持跨应用悬浮歌词，请在播放页查看歌词。')
    },
  }), [])
  return null
})
