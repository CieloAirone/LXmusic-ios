import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Songlist, { type SonglistType, type SonglistProps } from '@/screens/Home/Views/SongList/components/Songlist'
import { search } from '@/core/search/songlist'
import searchState, { type Source } from '@/store/search/songlist/state'

export interface MusicListType {
  loadList: (text: string, source: Source) => void
}

export default forwardRef<MusicListType, {}>((props, ref) => {
  const listRef = useRef<SonglistType>(null)
  const searchInfoRef = useRef<{ text: string, source: Source }>({ text: '', source: 'kw' })
  const isUnmountedRef = useRef(false)
  const generationRef = useRef(0)
  const loadingRef = useRef(false)
  const loadPage = async(page: number, refreshing = false) => {
    const request = ++generationRef.current
    const current = () => !isUnmountedRef.current && request === generationRef.current
    const { text, source } = searchInfoRef.current
    loadingRef.current = true
    listRef.current?.setStatus(refreshing ? 'refreshing' : 'loading')
    try {
      const list = await search(text, page, source, current)
      if (!current()) return
      const status = (searchState.maxPages[source] ?? 0) <= page ? 'end' : 'idle'
      requestAnimationFrame(() => {
        if (!current()) return
        listRef.current?.setList(list, source == 'all')
        listRef.current?.setStatus(status)
      })
    } catch {
      if (current()) listRef.current?.setStatus('error')
    } finally {
      if (current()) loadingRef.current = false
    }
  }
  useImperativeHandle(ref, () => ({
    async loadList(text, source) {
      const request = ++generationRef.current
      searchInfoRef.current = { text, source }
      loadingRef.current = false
      const info = searchState.listInfos[source]!
      const list = info.list
      if (searchState.searchText == text && searchState.source == source && list.length) {
        const status = (searchState.maxPages[source] ?? 0) <= info.page ? 'end' : 'idle'
        requestAnimationFrame(() => {
          if (isUnmountedRef.current || request !== generationRef.current) return
          listRef.current?.setList(list, source == 'all')
          listRef.current?.setStatus(status)
        })
      } else {
        listRef.current?.setList([], source == 'all')
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
    const info = searchState.listInfos[searchInfoRef.current.source]!
    void loadPage(info.list.length ? info.page + 1 : 1)
  }
  return <Songlist ref={listRef} onRefresh={handleRefresh} onLoadMore={handleLoadMore} />
})
