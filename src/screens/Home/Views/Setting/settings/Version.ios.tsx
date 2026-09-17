import { memo } from 'react'
import Section from '../components/Section'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
export default memo(() => {
  const t = useI18n()
  return <Section title={t('setting_version')}>
    <Text>LX Music {process.versions.app} · 非官方 iOS 移植版</Text>
    <Text>请通过原安装渠道更新。此版本不由 LX Music 原作者发布或维护。</Text>
  </Section>
})
