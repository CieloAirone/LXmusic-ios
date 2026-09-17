import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'

import ListMenu, { type ListMenuType } from './ListMenu'
import ListNameEdit, { type ListNameEditType } from './ListNameEdit'
import List from './List'
import ListImportExport, { type ListImportExportType } from './ListImportExport'
import { handleRemove, handleSync } from './listAction'
import ListMusicSort, { type ListMusicSortType } from './ListMusicSort'
import DuplicateMusic, { type DuplicateMusicType } from './DuplicateMusic'


export default () => {
  // iOS mounts drawer content after the open event (or a swipe), so it
  // cannot wait for the event that already caused this component to mount.
  const [visible, setVisible] = useState(Platform.OS === 'ios')
  const listMenuRef = useRef<ListMenuType>(null)
  const listNameEditRef = useRef<ListNameEditType>(null)
  const listMusicSortRef = useRef<ListMusicSortType>(null)
  const duplicateMusicRef = useRef<DuplicateMusicType>(null)
  const listImportExportRef = useRef<ListImportExportType>(null)

  useEffect(() => {
    if (Platform.OS === 'ios') return
    let isInited = false
    const changeVisible = (visibleList: boolean) => {
      if (visibleList && !isInited) {
        requestAnimationFrame(() => {
          setVisible(true)
        })
        isInited = true
      }
    }
    global.app_event.on('changeLoveListVisible', changeVisible)

    return () => {
      global.app_event.off('changeLoveListVisible', changeVisible)
    }
  }, [])

  return (
    visible
      ? <>
          <List onShowMenu={(info, position) => listMenuRef.current?.show(info, position)} />
          <ListNameEdit ref={listNameEditRef} />
          <ListMusicSort ref={listMusicSortRef} />
          <DuplicateMusic ref={duplicateMusicRef} />
          <ListImportExport ref={listImportExportRef} />
          <ListMenu
            ref={listMenuRef}
            onNew={index => listNameEditRef.current?.showCreate(index)}
            onRename={info => listNameEditRef.current?.show(info)}
            onSort={info => listMusicSortRef.current?.show(info)}
            onDuplicateMusic={info => duplicateMusicRef.current?.show(info)}
            onImport={(info, position) => listImportExportRef.current?.import(info, position)}
            onExport={(info, position) => listImportExportRef.current?.export(info, position)}
            onRemove={info => { handleRemove(info) }}
            onSync={info => { handleSync(info) }}
            onSelectLocalFile={(info, position) => listImportExportRef.current?.selectFile(info, position)}
          />
          {/* <ImportExport actionType={actionType} visible={isShowChoosePath} hide={() => setShowChoosePath(false)} selectedListRef={selectedListRef} /> */}
        </>
      : null
  )
}
