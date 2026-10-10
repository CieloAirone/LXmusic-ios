import { addListMusics, getListMusics, removeListMusics, removeUserList, setFetchingListStatus, updateListMusics } from '@/core/list'
import { confirmDialog, handleReadFile, handleSaveFile, showImportTip, toast } from '@/utils/tools'
import syncSourceList from '@/core/syncSourceList'
import { log } from '@/utils/log'
import { filterFileName, filterMusicList, formatPlayTime2, toNewMusicInfo } from '@/utils'
import { handleImportListPart } from '@/screens/Home/Views/Setting/settings/Backup/actions'
import { readMetadata, scanAudioFiles, type MusicMetadataFull } from '@/utils/localMediaMetadata'
import settingState from '@/store/setting/state'
import { type FileType } from '@/utils/fs'

export const handleRemove = (listInfo: LX.List.UserListInfo) => {
  void confirmDialog({
    message: global.i18n.t('list_remove_tip', { name: listInfo.name }),
    confirmButtonText: global.i18n.t('list_remove_tip_button'),
  }).then(isRemove => {
    if (!isRemove) return
    void removeUserList([listInfo.id])
  })
}

const readListData = async(path: string) => {
  let configData: any
  try {
    configData = await handleReadFile(path)
  } catch (error: any) {
    log.error(error.stack)
    throw error
  }
  let listData: LX.ConfigFile.MyListInfoPart['data']
  switch (configData.type) {
    case 'playListPart':
      listData = configData.data
      listData.list = filterMusicList(listData.list.map(m => toNewMusicInfo(m)))
      break
    case 'playListPart_v2':
      listData = configData.data
      break
    default:
      showImportTip(configData.type as string)
      return null
  }
  return listData
}

export const handleImport = (path: string, position: number) => {
  toast(global.i18n.t('setting_backup_part_import_list_tip_unzip'))
  void readListData(path).then(async listData => {
    if (listData == null) return
    void handleImportListPart(listData, position)
  }).catch((err) => {
    log.error(err)
    toast(global.i18n.t('setting_backup_part_import_list_tip_error'))
  })
}

const exportList = async(listInfo: LX.List.MyListInfo, path: string) => {
  const data = JSON.parse(JSON.stringify({
    type: 'playListPart_v2',
    data: {
      ...listInfo,
      list: await getListMusics(listInfo.id),
    },
  }))
  try {
    await handleSaveFile(`${path}/lx_list_part_${filterFileName(listInfo.name)}.lxmc`, data)
  } catch (error: any) {
    log.error(error.stack)
    throw error
  }
}
export const handleExport = (listInfo: LX.List.MyListInfo, path: string) => {
  toast(global.i18n.t('setting_backup_part_export_list_tip_zip'))
  exportList(listInfo, path).then(() => {
    toast(global.i18n.t('setting_backup_part_export_list_tip_success'))
  }).catch((err: any) => {
    log.error(err.message)
    toast(global.i18n.t('setting_backup_part_export_list_tip_failed') + ': ' + (err.message as string))
  })
}

export const handleSync = (listInfo: LX.List.UserListInfo) => {
  void confirmDialog({
    message: global.i18n.t('list_sync_confirm_tip', { name: listInfo.name }),
    confirmButtonText: global.i18n.t('list_remove_tip_button'),
  }).then(isSync => {
    if (!isSync) return
    void syncSourceList(listInfo).then(() => {
      toast(global.i18n.t('list_update_success', { name: listInfo.name }))
    }).catch(() => {
      toast(global.i18n.t('list_update_error', { name: listInfo.name }))
    })
  })
}

export const buildLocalMusicInfoByFilePath = (file: FileType): LX.Music.MusicInfoLocal => {
  const index = file.name.lastIndexOf('.')
  return {
    id: file.path,
    name: file.name.substring(0, index),
    singer: '',
    source: 'local',
    interval: null,
    meta: {
      albumName: '',
      filePath: file.path,
      songId: file.path,
      picUrl: '',
      ext: file.name.substring(index + 1),
    },
  }
}
export const buildLocalMusicInfo = (filePath: string, metadata: MusicMetadataFull): LX.Music.MusicInfoLocal => {
  return {
    id: filePath,
    name: metadata.name,
    singer: metadata.singer,
    source: 'local',
    interval: formatPlayTime2(metadata.interval),
    meta: {
      albumName: metadata.albumName,
      filePath,
      songId: filePath,
      picUrl: '',
      ext: metadata.ext,
    },
  }
}
const createLocalMusicInfos = async(filePaths: string[], errorPath: string[]): Promise<LX.Music.MusicInfoLocal[]> => {
  const list: LX.Music.MusicInfoLocal[] = []
  filePaths = [...filePaths]
  while (filePaths.length) {
    const tasks = [
      filePaths.shift(),
      filePaths.shift(),
      filePaths.shift(),
      filePaths.shift(),
      filePaths.shift(),
    ].filter(Boolean) as string[]

    await Promise.all(tasks.map(async path => readMetadata(path).catch((error: unknown) => {
      log.warn('Parse local metadata failed:', path.split('/').at(-1), String(error))
      return null
    }).then(info => ([path, info] as const)))).then((res) => {
      for (const [path, info] of res) {
        if (!info) {
          errorPath.push(path)
          continue
        }
        list.push(buildLocalMusicInfo(path, info))
      }
    })
  }
  return list
}

export const handleImportMediaFile = async(listInfo: LX.List.MyListInfo, path: string) => {
  setFetchingListStatus(listInfo.id, true)
  try {
    const files = await scanAudioFiles(path)
    if (!files.length) {
      toast(global.i18n.t('list_select_local_file_empty_tip'), 'long')
      return
    }
    await addListMusics(listInfo.id, files.map(buildLocalMusicInfoByFilePath), settingState.setting['list.addMusicLocationType'])
    toast(global.i18n.t('list_select_local_file_temp_add_tip', { total: files.length }), 'long')
    let failed = 0
    // Persist bounded batches before reporting completion; a bad file is isolated.
    for (let index = 0; index < files.length; index += 10) {
      const errorPaths: string[] = []
      const musicInfos = await createLocalMusicInfos(files.slice(index, index + 10).map(file => file.path), errorPaths)
      if (musicInfos.length) await updateListMusics(musicInfos.map(musicInfo => ({ id: listInfo.id, musicInfo })))
      if (errorPaths.length) await removeListMusics(listInfo.id, errorPaths)
      failed += errorPaths.length
    }
    toast(global.i18n.t(failed ? 'list_select_local_file_result_failed_tip' : 'list_select_local_file_result_tip', {
      total: files.length, success: files.length - failed, failed,
    }), 'long')
  } catch (error: unknown) {
    log.error('Local media import failed:', String(error))
    toast(global.i18n.t('setting_backup_part_import_list_tip_error'), 'long')
  } finally {
    setFetchingListStatus(listInfo.id, false)
  }
}
