import { encryptMsg, decryptMsg } from './utils'
import { callObj } from './sync'
// import { action as commonAction } from '@/store/modules/common'
// import { getStore } from '@/store'
// import registerSyncListHandler from './syncList'
import log from '../log'
import { aesEncrypt } from '../utils'
import { setSyncStatus } from '@/core/sync'
import { dateFormat } from '@/utils/common'
import { createMsg2call } from 'message2call'
import { toast } from '@/utils/tools'
import { SYNC_CLOSE_CODE, SYNC_CODE } from '../constants'

let status: LX.Sync.Status = {
  status: false,
  message: '',
}

export const sendSyncStatus = (newStatus: Omit<LX.Sync.Status, 'address'>) => {
  status.status = newStatus.status
  status.message = newStatus.message
  setSyncStatus(status)
}

export const sendSyncMessage = (message: string) => {
  status.message = message
  setSyncStatus(status)
}

const heartbeatTools = {
  failedNum: 0,
  maxTryNum: 100000,
  stepMs: 3000,
  connectTimeout: null as NodeJS.Timeout | null,
  pingTimeout: null as NodeJS.Timeout | null,
  delayRetryTimeout: null as NodeJS.Timeout | null,
  handleOpen(socket: LX.Sync.Socket) {
    console.log('open')
    // this.failedNum = 0
    this.heartbeat(socket)
  },
  heartbeat(socket: LX.Sync.Socket) {
    if (this.pingTimeout) clearTimeout(this.pingTimeout)

    // Use `WebSocket#terminate()`, which immediately destroys the connection,
    // instead of `WebSocket#close()`, which waits for the close timer.
    // Delay should be equal to the interval at which your server
    // sends out pings plus a conservative assumption of the latency.
    this.pingTimeout = setTimeout(() => {
      if (client === socket) socket.close()
    }, 30000 + 1000)
  },
  reConnnect(socket: LX.Sync.Socket) {
    if (client !== socket) return
    this.clearTimeout()
    // client = null
    if (!client) return

    if (++this.failedNum > this.maxTryNum) {
      this.failedNum = 0
      sendSyncStatus({
        status: false,
        message: 'Connect error',
      })
      throw new Error('connect error')
    }

    const waitTime = Math.min(2000 + Math.floor(this.failedNum / 2) * this.stepMs, 30000)

    // sendSyncStatus({
    //   status: false,
    //   message: `Waiting ${waitTime / 1000}s reconnnect...`,
    // })

    this.delayRetryTimeout = setTimeout(() => {
      this.delayRetryTimeout = null
      if (client !== socket) return
      console.log(dateFormat(new Date()), 'reconnnect...')
      sendSyncStatus({
        status: false,
        message: `Try reconnnect... (${this.failedNum})`,
      })
      connect(socket.data.urlInfo, socket.data.keyInfo)
    }, waitTime)
  },
  clearTimeout() {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout)
      this.connectTimeout = null
    }
    if (this.delayRetryTimeout) {
      clearTimeout(this.delayRetryTimeout)
      this.delayRetryTimeout = null
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout)
      this.pingTimeout = null
    }
  },
  connect(socket: LX.Sync.Socket) {
    console.log('heartbeatTools connect')
    this.connectTimeout = setTimeout(() => {
      if (client !== socket) return
      this.connectTimeout = null
      if (client) {
        try {
          client.close(SYNC_CLOSE_CODE.failed)
        } catch {}
      }
      if (++this.failedNum > this.maxTryNum) {
        this.failedNum = 0
        sendSyncStatus({
          status: false,
          message: 'Connect error',
        })
        throw new Error('connect error')
      }
      sendSyncStatus({
        status: false,
        message: 'Connect timeout, try reconnect...',
      })
      this.reConnnect(socket)
    }, 2 * 60 * 1000)
    socket.addEventListener('open', () => {
      if (client !== socket) return
      if (this.connectTimeout) {
        clearTimeout(this.connectTimeout)
        this.connectTimeout = null
      }
      this.handleOpen(socket)
    })
    socket.addEventListener('message', ({ data }) => {
      if (client !== socket) return
      if (data == 'ping') this.heartbeat(socket)
    })
    socket.addEventListener('close', (event) => {
      if (client !== socket) return
      // console.log(event.code)
      switch (event.code) {
        case SYNC_CLOSE_CODE.normal:
        case SYNC_CLOSE_CODE.failed:
          return
      }
      this.reConnnect(socket)
    })
  },
}


let client: LX.Sync.Socket | null
// let listSyncPromise: Promise<void>
export const connect = (urlInfo: LX.Sync.UrlInfo, keyInfo: LX.Sync.KeyInfo) => {
  heartbeatTools.clearTimeout()
  const previous = client
  client = null
  previous?.close(SYNC_CLOSE_CODE.normal)
  const socket = new WebSocket(`${urlInfo.wsProtocol}//${urlInfo.hostPath}/socket?i=${encodeURIComponent(keyInfo.clientId)}&t=${encodeURIComponent(aesEncrypt(SYNC_CODE.msgConnect, keyInfo.key))}`) as LX.Sync.Socket
  client = socket
  const isCurrent = () => client === socket
  socket.data = {
    keyInfo,
    urlInfo,
  }
  heartbeatTools.connect(socket)

  let closeEvents: Array<(err: Error) => (void | Promise<void>)> = []
  let disconnected = true

  const message2read = createMsg2call<LX.Sync.ServerSyncActions>({
    funcsObj: {
      ...callObj,
      finished() {
        if (!isCurrent() || disconnected) return
        toast('Sync connected')
        socket.isReady = true
        sendSyncStatus({
          status: true,
          message: '',
        })
        heartbeatTools.failedNum = 0
      },
    },
    timeout: 120 * 1000,
    sendMessage(data) {
      if (disconnected || !isCurrent()) throw new Error('disconnected')
      void encryptMsg(keyInfo, JSON.stringify(data)).then((data) => {
        if (!isCurrent() || disconnected) return
        socket.send(data)
      }).catch((err) => {
        if (!isCurrent() || disconnected) return
        log.error('encrypt msg error: ', err)
        sendSyncMessage('Sync send failed')
        socket.close(SYNC_CLOSE_CODE.failed)
      })
    },
    onCallBeforeParams(rawArgs) {
      return [socket, ...rawArgs]
    },
    onError(error, path, groupName) {
      if (!isCurrent() || disconnected) return
      const name = groupName ?? ''
      log.r_error(`sync call ${name} ${path.join('.')} error:`, error)
      sendSyncMessage(`Sync call failed: ${name} ${path.join('.')}`)
      // if (groupName == null) return
      // socket.close(SYNC_CLOSE_CODE.failed)
      // sendSyncStatus({
      //   status: false,
      //   message: error.message,
      // })
    },
  })

  socket.remote = message2read.remote
  socket.remoteQueueList = message2read.createQueueRemote('list')
  socket.remoteQueueDislike = message2read.createQueueRemote('dislike')

  socket.addEventListener('message', ({ data }) => {
    if (!isCurrent() || disconnected) return
    if (data == 'ping') return
    if (typeof data === 'string') {
      void decryptMsg(keyInfo, data).then((data) => {
        if (!isCurrent() || disconnected) return
        let syncData: LX.Sync.ServerSyncActions
        try {
          syncData = JSON.parse(data)
        } catch (err) {
          log.error('parse msg error: ', err)
          sendSyncMessage('Sync response is not valid JSON')
          socket.close(SYNC_CLOSE_CODE.failed)
          return
        }
        message2read.message(syncData)
      }).catch((error) => {
        if (!isCurrent() || disconnected) return
        log.error('decrypt msg error: ', error)
        sendSyncMessage('Sync response decompression failed')
        socket.close(SYNC_CLOSE_CODE.failed)
      })
    }
  })
  socket.onClose = function(handler: typeof closeEvents[number]) {
    closeEvents.push(handler)
    return () => {
      const index = closeEvents.indexOf(handler)
      if (index >= 0) closeEvents.splice(index, 1)
    }
  }

  const initMessage = 'Wait syncing...'
  socket.addEventListener('open', () => {
    if (!isCurrent()) return
    log.info('connect')
    // const store = getStore()
    // global.lx.syncKeyInfo = keyInfo
    socket.isReady = false
    socket.moduleReadys = {
      list: false,
      dislike: false,
    }
    disconnected = false
    sendSyncStatus({
      status: false,
      message: initMessage,
    })
  })
  socket.addEventListener('close', ({ code }) => {
    const err = new Error('closed')
    try {
      for (const handler of closeEvents) void handler(err)
    } catch (err: any) {
      log.error(err?.message)
    }
    closeEvents = []
    disconnected = true
    message2read.destroy()
    if (!isCurrent()) return
    switch (code) {
      case SYNC_CLOSE_CODE.normal:
      // case SYNC_CLOSE_CODE.failed:
        sendSyncStatus({
          status: false,
          message: '',
        })
        break
      case SYNC_CLOSE_CODE.failed:
        if (!status.message || status.message == initMessage) {
          sendSyncStatus({
            status: false,
            message: 'Sync closed (4100): check server sync log',
          })
        }
        break
    }
  })
  socket.addEventListener('error', ({ message }) => {
    if (!isCurrent()) return
    sendSyncStatus({
      status: false,
      message,
    })
  })
}

export const disconnect = async() => {
  if (!client) return
  log.info('disconnecting...')
  const socket = client
  client = null
  socket.close(SYNC_CLOSE_CODE.normal)
  sendSyncStatus({ status: false, message: '' })
  heartbeatTools.clearTimeout()
  heartbeatTools.failedNum = 0
}

export const getStatus = (): LX.Sync.Status => status
