import Peer from 'peerjs'
import store from '../stores'
import { setMyStream, addVideoStream, removeVideoStream } from '../stores/ComputerStore'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'

export default class ShareScreenManager {
  private myPeer: Peer
  myStream?: MediaStream
  private isPeerOpen = false
  private activeCalls = new Map<string, Peer.MediaConnection>()
  private retryInterval?: any

  constructor(private userId: string) {
    const sanatizedId = this.makeId(userId)
    this.myPeer = new Peer(sanatizedId)

    this.myPeer.on('open', (id) => {
      console.log('ShareScreen PeerJS connected with ID:', id)
      this.isPeerOpen = true
      this.connectToExistingUsers()
    })

    this.myPeer.on('error', (err: any) => {
      console.warn('ShareScreenWebRTC error:', err.type, err)
      // When a remote peer is not yet available, remove it so retry can try again
      if (err.type === 'peer-unavailable') {
        const errorMsg = err.message || ''
        const match = errorMsg.match(/peer\s+([^\s]+)/i)
        if (match && match[1]) {
          this.activeCalls.delete(match[1])
        }
      }
    })

    this.myPeer.on('call', (call) => {
      console.log('Receiving screen share call from:', call.peer)

      // If I am sharing my screen, answer with my stream. Otherwise answer empty.
      if (this.myStream) {
        call.answer(this.myStream)
      } else {
        call.answer()
      }

      this.activeCalls.set(call.peer, call)

      call.on('stream', (userVideoStream) => {
        console.log('Got remote screen stream from:', call.peer)
        store.dispatch(addVideoStream({ id: call.peer, call, stream: userVideoStream }))
      })

      call.on('close', () => {
        console.log('Screen share call closed:', call.peer)
        this.activeCalls.delete(call.peer)
        store.dispatch(removeVideoStream(call.peer))
      })

      call.on('error', (err) => {
        console.warn('Screen share call error:', call.peer, err)
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
  }

  onClose() {
    this.stopScreenShare(false)
    if (this.retryInterval) {
      clearInterval(this.retryInterval)
      this.retryInterval = undefined
    }
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

  // PeerJS throws invalid_id error if it contains some characters such as that colyseus generates.
  // Also for screen sharing ID add a `-ss` at the end.
  private makeId(id: string) {
    return `${id.replace(/[^0-9a-z]/gi, 'G')}-ss`
  }

  startScreenShare() {
    if (store.getState().computer.peerStreams.size > 0) {
      return
    }

    // @ts-ignore
    navigator.mediaDevices
      ?.getDisplayMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        const track = stream.getVideoTracks()[0]
        if (track) {
          track.onended = () => {
            this.stopScreenShare()
          }
        }

        this.myStream = stream
        store.dispatch(setMyStream(stream))

        // Immediately call all existing users at the computer
        this.broadcastScreenShare()

        // Start a heartbeat retry loop to catch any users connecting with latency
        if (this.retryInterval) clearInterval(this.retryInterval)
        this.retryInterval = setInterval(() => {
          if (!this.myStream) {
            clearInterval(this.retryInterval)
            return
          }
          this.broadcastScreenShare()
        }, 2000)
      })
      .catch((err) => {
        console.warn('Error starting display media:', err)
      })
  }

  private broadcastScreenShare() {
    const game = phaserGame.scene.keys.game as Game | undefined
    const computerId = store.getState().computer.computerId
    if (!game || !computerId) return

    const computerItem = game.computerMap.get(computerId)
    if (computerItem) {
      for (const userId of computerItem.currentUsers) {
        if (userId !== this.userId) {
          this.onUserJoined(userId)
        }
      }
    }
  }

  // When my peer opens, connect to any user already present at this computer
  private connectToExistingUsers() {
    const game = phaserGame.scene.keys.game as Game | undefined
    const computerId = store.getState().computer.computerId
    if (!game || !computerId) return

    const computerItem = game.computerMap.get(computerId)
    if (computerItem) {
      for (const userId of computerItem.currentUsers) {
        if (userId !== this.userId) {
          this.callUser(userId)
        }
      }
    }
  }

  stopScreenShare(shouldDispatch = true) {
    if (this.retryInterval) {
      clearInterval(this.retryInterval)
      this.retryInterval = undefined
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
      const game = phaserGame.scene.keys.game as Game | undefined
      const computerId = store.getState().computer.computerId
      if (game && computerId) {
        game.network.onStopScreenShare(computerId)
      }
    }
  }

  onUserJoined(userId: string) {
    if (userId === this.userId) return
    this.callUser(userId)
  }

  private callUser(userId: string) {
    if (!this.isPeerOpen) return

    const sanatizedId = this.makeId(userId)
    if (this.activeCalls.has(sanatizedId)) return

    try {
      // Call remote peer with our stream if we are sharing, or with empty stream if we are listening
      const call = this.myStream
        ? this.myPeer.call(sanatizedId, this.myStream)
        : this.myPeer.call(sanatizedId, new MediaStream())

      if (!call) return

      this.activeCalls.set(sanatizedId, call)

      call.on('stream', (userVideoStream) => {
        console.log('Received remote stream from called peer:', sanatizedId)
        store.dispatch(addVideoStream({ id: sanatizedId, call, stream: userVideoStream }))
      })

      call.on('close', () => {
        this.activeCalls.delete(sanatizedId)
        store.dispatch(removeVideoStream(sanatizedId))
      })

      call.on('error', (err) => {
        console.warn('Call error with peer:', sanatizedId, err)
        this.activeCalls.delete(sanatizedId)
        store.dispatch(removeVideoStream(sanatizedId))
      })
    } catch (e) {
      console.warn('Failed to call user:', sanatizedId, e)
    }
  }

  onUserLeft(userId: string) {
    if (userId === this.userId) return

    const sanatizedId = this.makeId(userId)
    const call = this.activeCalls.get(sanatizedId)
    if (call) {
      try {
        call.close()
      } catch (e) {}
      this.activeCalls.delete(sanatizedId)
    }
    store.dispatch(removeVideoStream(sanatizedId))
  }
}
