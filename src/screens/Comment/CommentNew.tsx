import { useEffect, useRef } from 'react'
import { filterList, getNewComment } from './utils'
import music from '@/utils/musicSdk'
import List, { type ListType } from './components/List'
const limit = 15

export default ({ musicInfo, onUpdateTotal }: {
  musicInfo: LX.Music.MusicInfoOnline
  onUpdateTotal: (total: number) => void
}) => {
  const listRef = useRef<ListType>(null)
  const listInfo = useRef({ page: 0, maxPage: 1, loading: false, end: false })
  const generationRef = useRef(0)
  const load = async(page: number, append = false, refreshing = false) => {
    const request = ++generationRef.current
    const current = () => request === generationRef.current
    listInfo.current.loading = true
    if (page == 1) listInfo.current.end = false
    listRef.current?.setStatus(refreshing ? 'refreshing' : 'loading')
    try {
      const { comments, maxPage, total } = await getNewComment(musicInfo, page, limit)
      if (!current()) return
      listInfo.current.page = page
      listInfo.current.maxPage = maxPage
      listInfo.current.end = page >= maxPage
      onUpdateTotal(total)
      listRef.current?.setList(filterList(append ? [...(listRef.current?.getList() ?? []), ...comments] : comments))
      listRef.current?.setStatus(listInfo.current.end ? 'end' : 'idle')
    } catch {
      if (current()) listRef.current?.setStatus('error')
    } finally {
      if (current()) listInfo.current.loading = false
    }
  }
  const handleListLoadMore = () => {
    if (listInfo.current.loading || listInfo.current.end) return
    void load(listInfo.current.page + 1, listInfo.current.page > 0)
  }
  const handleListRefresh = () => { void load(1, false, true) }
  useEffect(() => {
    listInfo.current = { page: 0, maxPage: 1, loading: false, end: false }
    listRef.current?.setList([])
    if (musicInfo.id && music[musicInfo.source]?.comment) void load(1)
    else listRef.current?.setStatus('end')
    const generation = generationRef
    return () => { generation.current++ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicInfo.id, musicInfo.source])
  return <List ref={listRef} onLoadMore={handleListLoadMore} onRefresh={handleListRefresh} />
}
