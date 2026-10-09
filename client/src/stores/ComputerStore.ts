import Peer from 'peerjs'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import ShareScreenManager from '../web/ShareScreenManager'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { sanitizeId } from '../util'

interface ComputerState {
  computerDialogOpen: boolean
  computerId: null | string
  myUserId: null | string
  myStream: null | MediaStream
  peerStreams: Map<
    string,
    {
      stream: MediaStream
      call: Peer.MediaConnection
    }
  >
  shareScreenManager: null | ShareScreenManager
  presenterId: null | string
}

const initialState: ComputerState = {
  computerDialogOpen: false,
  computerId: null,
  myUserId: null,
  myStream: null,
  peerStreams: new Map(),
  shareScreenManager: null,
  presenterId: null,
}

export const computerSlice = createSlice({
  name: 'computer',
  initialState,
  reducers: {
    openComputerDialog: (
      state,
      action: PayloadAction<{ computerId: string; myUserId: string }>
    ) => {
      if (!state.shareScreenManager) {
        state.shareScreenManager = new ShareScreenManager(action.payload.myUserId)
      }
      const game = phaserGame.scene.keys.game as Game
      game.disableKeys()
      state.shareScreenManager.onOpen()
      state.computerDialogOpen = true
      state.computerId = action.payload.computerId
      state.myUserId = action.payload.myUserId
    },
    closeComputerDialog: (state) => {
      // Tell server the computer dialog is closed.
      const game = phaserGame.scene.keys.game as Game
      game.enableKeys()
      if (state.computerId) {
        game.network.disconnectFromComputer(state.computerId)
      }
      for (const { call } of state.peerStreams.values()) {
        try {
          call.close()
        } catch (e) {}
      }
      state.shareScreenManager?.onClose()
      state.shareScreenManager = null
      state.computerDialogOpen = false
      state.myStream = null
      state.computerId = null
      state.myUserId = null
      state.peerStreams = new Map()
      state.presenterId = null
    },
    setMyStream: (state, action: PayloadAction<null | MediaStream>) => {
      state.myStream = action.payload
      if (action.payload && state.myUserId) {
        state.presenterId = sanitizeId(state.myUserId)
      } else if (
        !action.payload &&
        state.presenterId === (state.myUserId ? sanitizeId(state.myUserId) : null)
      ) {
        state.presenterId = null
      }
    },
    setPresenterId: (state, action: PayloadAction<null | string>) => {
      state.presenterId = action.payload ? sanitizeId(action.payload) : null
    },
    addVideoStream: (
      state,
      action: PayloadAction<{ id: string; call: Peer.MediaConnection; stream: MediaStream }>
    ) => {
      const sanitized = sanitizeId(action.payload.id)
      const nextMap = new Map(state.peerStreams)
      nextMap.set(sanitized, {
        call: action.payload.call,
        stream: action.payload.stream,
      })
      state.peerStreams = nextMap
      if (!state.presenterId || state.presenterId === sanitized) {
        state.presenterId = sanitized
      }
    },
    removeVideoStream: (state, action: PayloadAction<string>) => {
      const sanitized = sanitizeId(action.payload)
      const nextMap = new Map(state.peerStreams)
      nextMap.delete(sanitized)
      state.peerStreams = nextMap
      if (state.presenterId === sanitized) {
        state.presenterId = nextMap.keys().next().value || null
      }
    },
  },
})

export const {
  closeComputerDialog,
  openComputerDialog,
  setMyStream,
  setPresenterId,
  addVideoStream,
  removeVideoStream,
} = computerSlice.actions

export default computerSlice.reducer
