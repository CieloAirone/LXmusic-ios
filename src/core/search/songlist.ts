import searchSonglistState, { type Source, type ListInfoItem } from '@/store/search/songlist/state'
import searchSonglistActions, { type SearchResult } from '@/store/search/songlist/action'
import musicSdk from '@/utils/musicSdk'

export const setSource: typeof searchSonglistActions['setSource'] = (source) => {
  searchSonglistActions.setSource(source)
}
export const setSearchText: typeof searchSonglistActions['setSearchText'] = (text) => {
  searchSonglistActions.setSearchText(text)
}
const setListInfo: typeof searchSonglistActions.setListInfo = (result, page, text) => {
  return searchSonglistActions.setListInfo(result, page, text)
}

export const clearListInfo: typeof searchSonglistActions.clearListInfo = (source) => {
  searchSonglistActions.clearListInfo(source)
}


let requestGeneration = 0
export const search = async(text: string, page: number, sourceId: Source, isCurrent: () => boolean = () => true): Promise<ListInfoItem[]> => {
  const request = ++requestGeneration
  const isStale = () => request !== requestGeneration || !isCurrent()
  const listInfo = searchSonglistState.listInfos[sourceId]!
  // if (!text) return []
  const key = `${page}__${sourceId}__${text}`
  if (listInfo.key == key && listInfo.list.length && listInfo.page == page && searchSonglistState.searchText == text) return listInfo.list
  if (sourceId == 'all') {
    listInfo.key = key
    let task = []
    for (const source of searchSonglistState.sources) {
      if (source == 'all' || (page > 1 && page > (searchSonglistState.maxPages[source]!))) continue
      task.push(((musicSdk[source]?.songList.search(text, page, searchSonglistState.listInfos.all.limit) as Promise<SearchResult>) ?? Promise.reject(new Error('source not found: ' + source))).catch((error: any) => {
        console.log(error)
        return {
          list: [],
          total: 0,
          limit: searchSonglistState.listInfos.all.limit,
          source,
        }
      }))
    }
    return Promise.all(task).then((results: SearchResult[]) => {
      if (isStale() || key != listInfo.key) return []
      setSearchText(text)
      setSource(sourceId)
      return setListInfo(results, page, text)
    })
  } else {
    if (listInfo?.key == key && listInfo?.list.length && listInfo.page == page && searchSonglistState.searchText == text) return listInfo?.list
    listInfo.key = key
    return ((musicSdk[sourceId]?.songList.search(text, page, listInfo.limit) as Promise<SearchResult>).then((data: SearchResult) => {
      if (isStale() || key != listInfo.key) return []
      setSearchText(text)
      return setListInfo(data, page, text)
    }) ?? Promise.reject(new Error('source not found: ' + sourceId))).catch((err: any) => {
      if (isStale()) return []
      if (listInfo.list.length && page == 1) clearListInfo(sourceId)
      throw err
    })
  }
}
