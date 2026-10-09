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

  if (!nextMuted) {
    // 1. Inicializa o AudioContext
    await proximityAudio.init()

    // 2. Se o microfone ainda não foi inicializado, abre via getUserMedia de áudio puro
    if (!proximityAudio.getMicStream() || !proximityAudio.getMicStream()?.active) {
      const ok = await proximityAudio.enableMicrophone((_vol, speaking) => {
        if (game?.myPlayer && !store.getState().user.microphoneMuted) {
          game.myPlayer.setSpeaking(speaking)
        }
      })
      if (!ok) {
        return true // Permanece mutado se permissão for negada
      }
    }

    proximityAudio.setMicrophoneMuted(false)

    // 3. Compartilha a faixa de áudio com a malha WebRTC
    const stream = proximityAudio.getMicStream()
    if (stream && game?.network?.webRTC) {
      game.network.webRTC.setAudioStream(stream)
    }

    store.dispatch(setMicrophoneMuted(false))
    return false
  } else {
    // 1. Aplica mute no motor de áudio e desabilita faixas
    proximityAudio.setMicrophoneMuted(true)

    // 2. Desabilita áudio no WebRTC
    if (game?.network?.webRTC) {
      game.network.webRTC.setAudioEnabled(false)
    }

    // 3. Atualiza estado no Redux
    store.dispatch(setMicrophoneMuted(true))

    // 4. Desliga imediatamente o anel visual de fala do jogador local
    if (game?.myPlayer) {
      game.myPlayer.setSpeaking(false)
    }

    return true
  }
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

