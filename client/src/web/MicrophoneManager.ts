import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import store from '../stores'
import { setMicrophoneMuted, setMicMuted } from '../stores/UserStore'

/**
 * Alterna ou define o estado de mudo do microfone
 */
export async function toggleMicrophoneMute(): Promise<boolean> {
  const game = phaserGame.scene.keys.game as Game | undefined
  const webRTC = game?.network?.webRTC

  if (!webRTC) return true

  const currentMuted = store.getState().user.microphoneMuted
  if (currentMuted) {
    // Desmutar ou requisitar microfone se ainda não foi concedido
    const stream = await webRTC.ensureMicrophone()
    if (stream) {
      webRTC.setAudioEnabled(true)
      return false
    } else {
      store.dispatch(setMicrophoneMuted(true))
      store.dispatch(setMicMuted(true))
      return true
    }
  } else {
    // Mutar microfone
    webRTC.setAudioEnabled(false)
    return true
  }
}

export function setMicrophoneMuteState(muted: boolean) {
  const game = phaserGame.scene.keys.game as Game | undefined
  const webRTC = game?.network?.webRTC

  if (webRTC) {
    webRTC.setAudioEnabled(!muted)
  } else {
    store.dispatch(setMicrophoneMuted(muted))
    store.dispatch(setMicMuted(muted))
  }
}
