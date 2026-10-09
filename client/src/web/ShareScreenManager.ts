import Peer from 'peerjs'
import store from '../stores'
import {
  setMyStream,
  setPresenterId,
  addVideoStream,
  removeVideoStream,
} from '../stores/ComputerStore'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { sanitizeId } from '../util'

export default class ShareScreenManager {
  private myPeer: Peer
  myStream?: MediaStream
  private isPeerOpen = false
  private activeCalls = new Map<string, Peer.MediaConnection>()
  private activeDataConns = new Map<string, Peer.DataConnection>()
  private retryInterval?: any

  constructor(private userId: string) {
    const sanatizedId = this.makeId(userId)
    this.myPeer = new Peer(sanatizedId)

    this.myPeer.on('open', (id) => {
      console.log('[ShareScreen] PeerJS connected with ID:', id)
      this.isPeerOpen = true
      this.connectToExistingUsers()
    })

    this.myPeer.on('error', (err: any) => {
      console.warn('[ShareScreen] PeerJS error:', err.type, err)
      if (err.type === 'peer-unavailable') {
        const errorMsg = err.message || ''
        const match = errorMsg.match(/peer\s+([^\s]+)/i)
        if (match && match[1]) {
          this.activeCalls.delete(match[1])
          this.activeDataConns.delete(match[1])
        }
      }
    })

    // Listen for incoming DataConnections (signaling & presenter status)
    this.myPeer.on('connection', (conn) => {
      this.activeDataConns.set(conn.peer, conn)

      conn.on('data', (data: any) => {
        if (!data || typeof data !== 'object') return

        if (data.type === 'CHECK_PRESENTER') {
          // A viewer joined and is asking if anyone is presenting
          if (this.myStream) {
            conn.send({
              type: 'PRESENTER_STATUS',
              isPresenter: true,
              presenterId: this.userId,
            })
            // Immediately send our screen share call to this viewer
            if (data.from) {
              this.callUser(data.from)
            }
          } else {
            conn.send({
              type: 'PRESENTER_STATUS',
              isPresenter: false,
            })
          }
        } else if (data.type === 'PRESENTER_STATUS') {
          if (data.isPresenter && data.presenterId) {
            store.dispatch(setPresenterId(data.presenterId))
          }
        } else if (data.type === 'STOP_SCREEN_SHARE') {
          store.dispatch(setPresenterId(null))
          if (data.presenterId) {
            store.dispatch(removeVideoStream(data.presenterId))
          }
        }
      })

      conn.on('close', () => {
        this.activeDataConns.delete(conn.peer)
      })
    })

    // Listen for incoming MediaConnection calls (receiving screen share)
    this.myPeer.on('call', (call) => {
      console.log('[ShareScreen] Receiving call from:', call.peer)

      // If I am sharing, answer with my stream. Otherwise answer to receive.
      if (this.myStream) {
        call.answer(this.myStream)
      } else {
        call.answer()
      }

      this.activeCalls.set(call.peer, call)

      call.on('stream', (userVideoStream) => {
        console.log('[ShareScreen] Got remote screen stream from:', call.peer)
        if (userVideoStream.getVideoTracks().length > 0) {
          store.dispatch(addVideoStream({ id: call.peer, call, stream: userVideoStream }))
          store.dispatch(setPresenterId(call.peer))
        }
      })

      call.on('close', () => {
        console.log('[ShareScreen] Screen share call closed:', call.peer)
        this.activeCalls.delete(call.peer)
        store.dispatch(removeVideoStream(call.peer))
      })

      call.on('error', (err) => {
        console.warn('[ShareScreen] Screen share call error:', call.peer, err)
        this.activeCalls.delete(call.peer)
        store.dispatch(removeVideoStream(call.peer))
      })
    })
  }

  onOpen() {
    if (this.myPeer.destroyed) {
      const sanatizedId = this.makeId(this.userId)
      this.myPeer = new Peer(sanatizedId)
    } else if (this.myPeer.disconnected) {
      this.myPeer.reconnect()
    }
    if (this.isPeerOpen) {
      this.connectToExistingUsers()
    }
  }

  onClose() {
    this.stopScreenShare(false)
    if (this.retryInterval) {
      clearInterval(this.retryInterval)
      this.retryInterval = undefined
    }

    for (const conn of this.activeDataConns.values()) {
      try {
        conn.close()
      } catch (e) {}
    }
    this.activeDataConns.clear()

    for (const call of this.activeCalls.values()) {
      try {
        call.close()
      } catch (e) {}
    }
    this.activeCalls.clear()

    try {
      this.myPeer.destroy()
    } catch (e) {}
  }

  private makeId(id: string) {
    return `${sanitizeId(id)}-ss`
  }

  startScreenShare() {
    const computerState = store.getState().computer
    if (computerState.peerStreams.size > 0 || computerState.presenterId) {
      console.warn('[ShareScreen] Another user is already presenting')
      return
    }

    // @ts-ignore
    navigator.mediaDevices
      ?.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: true,
      })
      .then((stream) => {
        const track = stream.getVideoTracks()[0]
        if (track) {
          if ('contentHint' in track) {
            track.contentHint = 'detail'
          }
          track.onended = () => {
            this.stopScreenShare()
          }
        }

        this.myStream = stream
        store.dispatch(setMyStream(stream))
        store.dispatch(setPresenterId(this.userId))

        // Immediately call all existing users at the computer
        this.broadcastScreenShare()

        // Heartbeat retry loop to ensure any newly arriving viewer receives the stream
        if (this.retryInterval) clearInterval(this.retryInterval)
        this.retryInterval = setInterval(() => {
          if (!this.myStream) {
            clearInterval(this.retryInterval)
            return
          }
          this.broadcastScreenShare()
        }, 1500)
      })
      .catch((err) => {
        console.warn('Error starting display media:', err)
      })
  }

  private broadcastScreenShare() {
    const game = phaserGame.scene.keys.game as Game | undefined
    const computerId = store.getState().computer.computerId
    if (!game || !computerId || !this.myStream) return

    const computerItem = game.computerMap.get(computerId)
    if (computerItem) {
      for (const userId of computerItem.currentUsers) {
        if (userId !== this.userId) {
          this.callUser(userId)
        }
      }
    }
  }

  // When my peer opens, query or connect to users present at this computer
  private connectToExistingUsers() {
    const game = phaserGame.scene.keys.game as Game | undefined
    const computerId = store.getState().computer.computerId
    if (!game || !computerId) return

    const computerItem = game.computerMap.get(computerId)
    if (computerItem) {
      for (const userId of computerItem.currentUsers) {
        if (userId !== this.userId) {
          if (this.myStream) {
            this.callUser(userId)
          } else {
            this.queryUser(userId)
          }
        }
      }
    }
  }

  // Query a user to check if they are presenting
  private queryUser(userId: string) {
    if (!this.isPeerOpen) return
    const targetPeerId = this.makeId(userId)

    try {
      const conn = this.myPeer.connect(targetPeerId)
      if (!conn) return

      this.activeDataConns.set(targetPeerId, conn)

      conn.on('open', () => {
        conn.send({
          type: 'CHECK_PRESENTER',
          from: this.userId,
        })
      })

      conn.on('data', (data: any) => {
        if (data?.type === 'PRESENTER_STATUS' && data.isPresenter && data.presenterId) {
          store.dispatch(setPresenterId(data.presenterId))
        }
      })

      conn.on('close', () => {
        this.activeDataConns.delete(targetPeerId)
      })
    } catch (e) {
      console.warn('[ShareScreen] Error querying user:', targetPeerId, e)
    }
  }

  stopScreenShare(shouldDispatch = true) {
    if (this.retryInterval) {
      clearInterval(this.retryInterval)
      this.retryInterval = undefined
    }

    // Broadcast STOP signal via open data connections
    for (const conn of this.activeDataConns.values()) {
      try {
        if (conn.open) {
          conn.send({ type: 'STOP_SCREEN_SHARE', presenterId: this.userId })
        }
      } catch (e) {}
    }

    this.myStream?.getTracks().forEach((track) => track.stop())
    this.myStream = undefined

    for (const call of this.activeCalls.values()) {
      try {
        call.close()
      } catch (e) {}
    }
    this.activeCalls.clear()

    if (shouldDispatch) {
      store.dispatch(setMyStream(null))
      store.dispatch(setPresenterId(null))
      const game = phaserGame.scene.keys.game as Game | undefined
      const computerId = store.getState().computer.computerId
      if (game && computerId) {
        game.network.onStopScreenShare(computerId)
      }
    }
  }

  onUserJoined(userId: string) {
    if (userId === this.userId) return

    if (this.myStream) {
      this.callUser(userId)
    } else {
      this.queryUser(userId)
    }
  }

  private callUser(userId: string) {
    if (!this.isPeerOpen || !this.myStream) return

    const targetPeerId = this.makeId(userId)

    // Send instant data message that we are presenting
    try {
      let conn = this.activeDataConns.get(targetPeerId)
      if (!conn || !conn.open) {
        conn = this.myPeer.connect(targetPeerId)
        this.activeDataConns.set(targetPeerId, conn)
        conn.on('open', () => {
          conn?.send({
            type: 'PRESENTER_STATUS',
            isPresenter: true,
            presenterId: this.userId,
          })
        })
      } else {
        conn.send({
          type: 'PRESENTER_STATUS',
          isPresenter: true,
          presenterId: this.userId,
        })
      }
    } catch (e) {}

    // Check if we already have an active media call
    const existingCall = this.activeCalls.get(targetPeerId)
    if (existingCall && existingCall.open) {
      return
    }

    try {
      console.log('[ShareScreen] Calling user with display stream:', targetPeerId)
      const call = this.myPeer.call(targetPeerId, this.myStream)
      if (!call) return

      this.activeCalls.set(targetPeerId, call)

      try {
        const pc = (call as any).peerConnection as RTCPeerConnection | undefined
        if (pc) {
          pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'connected') {
              const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video')
              if (videoSender) {
                const params = videoSender.getParameters()
                if (params.encodings && params.encodings.length > 0) {
                  params.encodings[0].maxBitrate = 2500000 // 2.5 Mbps ideal para 1080p leve
                  videoSender.setParameters(params).catch(() => {})
                }
              }
            }
          })
        }
      } catch (e) {}

      call.on('close', () => {
        this.activeCalls.delete(targetPeerId)
      })

      call.on('error', (err) => {
        console.warn('[ShareScreen] Call error with peer:', targetPeerId, err)
        this.activeCalls.delete(targetPeerId)
      })
    } catch (e) {
      console.warn('[ShareScreen] Failed to call user:', targetPeerId, e)
    }
  }

  onUserLeft(userId: string) {
    if (userId === this.userId) return

    const targetPeerId = this.makeId(userId)
    const call = this.activeCalls.get(targetPeerId)
    if (call) {
      try {
        call.close()
      } catch (e) {}
      this.activeCalls.delete(targetPeerId)
    }

    const conn = this.activeDataConns.get(targetPeerId)
    if (conn) {
      try {
        conn.close()
      } catch (e) {}
      this.activeDataConns.delete(targetPeerId)
    }

    store.dispatch(removeVideoStream(targetPeerId))
    const currentPresenter = store.getState().computer.presenterId
    if (currentPresenter === sanitizeId(userId) || currentPresenter === sanitizeId(targetPeerId)) {
      store.dispatch(setPresenterId(null))
    }
  }
}
