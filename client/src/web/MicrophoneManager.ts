import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import store from '../stores'
import { setMicrophoneMuted } from '../stores/UserStore'
import { proximityAudio } from './ProximityAudio'

/**
 * Alterna ou define o estado de mudo do microfone em todo o ecossistema (WebRTC + Web Audio 3D)
 */
export async function toggleMicrophoneMute(): Promise<boolean> {
  const game = phaserGame.scene.keys.game as Game | undefined
  const currentMuted = store.getState().user.microphoneMuted
  const nextMuted = !currentMuted

  // Se o microfone ainda não foi inicializado e o usuário quer desmutar, ativa-o
  if (!nextMuted && !proximityAudio.getMicStream() && !game?.network?.webRTC?.isAudioEnabled()) {
    if (game?.network?.webRTC) {
      game.network.webRTC.getUserMedia(false)
    }
    const ok = await proximityAudio.enableMicrophone((_vol, speaking) => {
      if (game?.myPlayer && !store.getState().user.microphoneMuted) {
        game.myPlayer.setSpeaking(speaking)
      }
    })
    if (ok) {
      store.dispatch(setMicrophoneMuted(false))
      game?.network?.webRTC?.setAudioEnabled(true)
      return false
    }
  }

  // 1. Aplica o estado no motor de áudio de proximidade
  proximityAudio.setMicrophoneMuted(nextMuted)

  // 2. Aplica o estado nas faixas de áudio transmitidas via WebRTC P2P
  if (game?.network?.webRTC) {
    game.network.webRTC.setAudioEnabled(!nextMuted)
  }

  // 3. Atualiza o estado global no Redux
  store.dispatch(setMicrophoneMuted(nextMuted))

  // 4. Se mutado, desliga imediatamente o anel visual de fala do jogador local
  if (nextMuted && game?.myPlayer) {
    game.myPlayer.setSpeaking(false)
  }

  return nextMuted
}

export function setMicrophoneMuteState(muted: boolean) {
  const game = phaserGame.scene.keys.game as Game | undefined

  proximityAudio.setMicrophoneMuted(muted)

  if (game?.network?.webRTC) {
    game.network.webRTC.setAudioEnabled(!muted)
  }

  store.dispatch(setMicrophoneMuted(muted))

  if (muted && game?.myPlayer) {
    game.myPlayer.setSpeaking(false)
  }
}
