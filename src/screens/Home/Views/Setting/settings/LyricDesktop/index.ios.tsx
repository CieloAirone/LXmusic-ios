import { memo } from 'react'
import Section from '../../components/Section'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
export default memo(() => {
  const t = useI18n()
  return <Section title={t('setting_lyric_desktop')}>
    <Text>iOS 不支持跨应用悬浮歌词。请在播放页查看滚动歌词、翻译和罗马音；锁屏可控制音乐播放。</Text>
  </Section>
})
