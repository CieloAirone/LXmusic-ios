import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import OnlineList, { type OnlineListType, type OnlineListProps } from '@/components/OnlineList'
import { getListDetail, setListDetail, setListDetailInfo } from '@/core/leaderboard'
import boardState from '@/store/leaderboard/state'
import { handlePlay } from './listAction'

export interface MusicListType {
  loadList: (source: LX.OnlineSource, listId: string) => void
}
export default forwardRef<MusicListType, {}>((props, ref) => {
  const listRef = useRef<OnlineListType>(null)
  const isUnmountedRef = useRef(false)
  const generationRef = useRef(0)
  const loadingRef = useRef(false)
  const idRef = useRef('')
  const loadPage = async(page: number, refreshing = false, append = false) => {
    const request = ++generationRef.current
    const id = idRef.current
    const current = () => !isUnmountedRef.current && request === generationRef.current
    loadingRef.current = true
    listRef.current?.setStatus(refreshing ? 'refreshing' : 'loading')
    try {
      const info = await getListDetail(id, page, refreshing)
      if (!current()) return
      const result = setListDetail(info, id, page)
      const list = result.list
      const status = result.maxPage <= page ? 'end' : 'idle'
      requestAnimationFrame(() => {
        if (!current()) return
        listRef.current?.setList(list, append)
        listRef.current?.setStatus(status)
      })
    } catch {
      if (current()) listRef.current?.setStatus('error')
    } finally {
      if (current()) loadingRef.current = false
    }
  }
  useImperativeHandle(ref, () => ({
    async loadList(source, id) {
      const request = ++generationRef.current
      idRef.current = id
      loadingRef.current = false
      const info = boardState.listDetailInfo
      if (info.source === source && info.id === id && info.list.length) {
        const list = info.list
        const status = info.maxPage <= info.page ? 'end' : 'idle'
        requestAnimationFrame(() => {
          if (isUnmountedRef.current || request !== generationRef.current) return
          listRef.current?.setList(list)
          listRef.current?.setStatus(status)
        })
      } else {
        setListDetailInfo(id)
        listRef.current?.setList([])
        await loadPage(1)
      }
    },
  }), [])
  useEffect(() => {
    isUnmountedRef.current = false
    const generation = generationRef
    return () => {
      isUnmountedRef.current = true
      generation.current++
    }
  }, [])
  const handlePlayList: OnlineListProps['onPlayList'] = (index) => {
    const info = boardState.listDetailInfo
    void handlePlay(info.id, info.list, index)
  }
  const handleRefresh: OnlineListProps['onRefresh'] = () => { void loadPage(1, true) }
  const handleLoadMore: OnlineListProps['onLoadMore'] = () => {
    if (loadingRef.current) return
    const info = boardState.listDetailInfo
    void loadPage(info.list.length ? info.page + 1 : 1, false, true)
  }
  return <OnlineList ref={listRef} onPlayList={handlePlayList} onRefresh={handleRefresh} onLoadMore={handleLoadMore} checkHomePagerIdle rowType='medium' />
})
