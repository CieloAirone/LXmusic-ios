import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import OnlineList, { type OnlineListType, type OnlineListProps } from '@/components/OnlineList'
import { search } from '@/core/search/music'
import searchState, { type Source } from '@/store/search/music/state'

export interface MusicListType {
  loadList: (text: string, source: Source) => void
}

export default forwardRef<MusicListType, {}>((props, ref) => {
  const listRef = useRef<OnlineListType>(null)
  const searchInfoRef = useRef<{ text: string, source: Source }>({ text: '', source: 'kw' })
  const isUnmountedRef = useRef(false)
  const generationRef = useRef(0)
  const loadingRef = useRef(false)
  const loadPage = async(page: number, append = false, refreshing = false) => {
    const request = ++generationRef.current
    const current = () => !isUnmountedRef.current && request === generationRef.current
    const { text, source } = searchInfoRef.current
    loadingRef.current = true
    listRef.current?.setStatus(refreshing ? 'refreshing' : 'loading')
    try {
      const list = await search(text, page, source, current)
      if (!current()) return
      const info = searchState.listInfos[source]!
      const status = info.maxPage <= page ? 'end' : 'idle'
      requestAnimationFrame(() => {
        if (!current()) return
        listRef.current?.setList(list, append, source == 'all')
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
        const status = info.maxPage <= info.page ? 'end' : 'idle'
        requestAnimationFrame(() => {
          if (isUnmountedRef.current || request !== generationRef.current) return
          listRef.current?.setList(list, false, source == 'all')
          listRef.current?.setStatus(status)
        })
      } else {
        listRef.current?.setList([], false, source == 'all')
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
  const handleRefresh: OnlineListProps['onRefresh'] = () => { void loadPage(1, false, true) }
  const handleLoadMore: OnlineListProps['onLoadMore'] = () => {
    if (loadingRef.current) return
    const info = searchState.listInfos[searchInfoRef.current.source]!
    void loadPage(info.list.length ? info.page + 1 : 1, true)
  }
  return <OnlineList ref={listRef} onRefresh={handleRefresh} onLoadMore={handleLoadMore} checkHomePagerIdle />
})
