import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Songlist, { type SonglistProps, type SonglistType } from './components/Songlist'
import { getList, setList, setListInfo } from '@/core/songlist'
import songlistState, { type Source } from '@/store/songlist/state'

export interface ListType {
  loadList: (source: Source, sortId: string, tagId: string) => void
}
export default forwardRef<ListType, {}>((props, ref) => {
  const listRef = useRef<SonglistType>(null)
  const isUnmountedRef = useRef(false)
  const generationRef = useRef(0)
  const loadingRef = useRef(false)
  const queryRef = useRef({ source: songlistState.listInfo.source, tagId: '', sortId: '' })
  const loadPage = async(page: number, refreshing = false) => {
    const request = ++generationRef.current
    const { source, tagId, sortId } = queryRef.current
    const current = () => !isUnmountedRef.current && request === generationRef.current
    loadingRef.current = true
    listRef.current?.setStatus(refreshing ? 'refreshing' : 'loading')
    try {
      const info = await getList(source, tagId, sortId, page, refreshing)
      if (!current()) return
      const result = setList(info, tagId, sortId, page)
      const list = result.list
      const status = result.maxPage <= page ? 'end' : 'idle'
      requestAnimationFrame(() => {
        if (!current()) return
        listRef.current?.setList(list)
        listRef.current?.setStatus(status)
      })
    } catch {
      if (current()) listRef.current?.setStatus('error')
    } finally {
      if (current()) loadingRef.current = false
    }
  }
  useImperativeHandle(ref, () => ({
    async loadList(source, sortId, tagId) {
      const request = ++generationRef.current
      queryRef.current = { source, sortId, tagId }
      loadingRef.current = false
      const info = songlistState.listInfo
      if (info.source === source && info.sortId === sortId && info.tagId === tagId && info.list.length) {
        const list = info.list
        const status = info.maxPage <= info.page ? 'end' : 'idle'
        requestAnimationFrame(() => {
          if (isUnmountedRef.current || request !== generationRef.current) return
          listRef.current?.setList(list)
          listRef.current?.setStatus(status)
        })
      } else {
        setListInfo(source, tagId, sortId)
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
  const handleRefresh: SonglistProps['onRefresh'] = () => { void loadPage(1, true) }
  const handleLoadMore: SonglistProps['onLoadMore'] = () => {
    if (loadingRef.current) return
    const info = songlistState.listInfo
    void loadPage(info.list.length ? info.page + 1 : 1)
  }
  return <Songlist ref={listRef} onRefresh={handleRefresh} onLoadMore={handleLoadMore} />
})
