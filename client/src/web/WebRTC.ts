import Peer from 'peerjs'
import Network from '../services/Network'
import store from '../stores'
import {
  setVideoConnected,
  setMicMuted,
  setVideoMuted,
  setMicrophoneMuted,
} from '../stores/UserStore'
import phaserGame from '../PhaserGame'

interface PeerAudioEntry {
  audio: HTMLAudioElement
  analyser?: AnalyserNode
}

export default class WebRTC {
  private myPeer: Peer
  private peers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private onCalledPeers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private peerAudios = new Map<string, PeerAudioEntry>()
  private pendingCalls = new Set<string>()
  private isPeerOpen = false

  private videoGrid = document.querySelector('.video-grid')
  private myVideo = document.createElement('video')
  private myStream?: MediaStream
  private network: Network
  private audioContext?: AudioContext
  private localAnalyser?: AnalyserNode

  constructor(userId: string, network: Network) {
    const sanitizedId = this.replaceInvalidId(userId)
    this.myPeer = new Peer(sanitizedId)
    this.network = network

    this.myPeer.on('open', (id) => {
      console.log('[WebRTC] PeerJS conectado com ID:', id)
      this.isPeerOpen = true
      this.pendingCalls.forEach((uid) => {
        this.connectToNewUser(uid)
      })
      this.pendingCalls.clear()
    })

    this.myPeer.on('error', (err: any) => {
      console.warn('[WebRTC] PeerJS error:', err?.type, err)
    })

    // Mute own video element (never listen to yourself)
    this.myVideo.muted = true

    // Resume AudioContext on any user interaction with the window
    const unlockAudio = () => {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {})
      }
      this.peerAudios.forEach(({ audio }) => {
        if (audio.paused && audio.srcObject) {
          audio.play().catch(() => {})
        }
      })
    }
    window.addEventListener('click', unlockAudio, { passive: true })
    window.addEventListener('keydown', unlockAudio, { passive: true })

    this.initialize()
  }

  getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      this.audioContext = new AudioCtx()
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {})
    }
    return this.audioContext
  }

  // PeerJS throws invalid_id error if it contains characters outside [0-9a-z]
  replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  createSilentAudioStream(): MediaStream {
    try {
      const ctx = this.getAudioContext()
      const oscillator = ctx.createOscillator()
      const dst = ctx.createMediaStreamDestination()
      const gain = ctx.createGain()
      gain.gain.value = 0
      oscillator.connect(gain)
      gain.connect(dst)
      oscillator.start()
      return dst.stream
    } catch (_) {
      return new MediaStream()
    }
  }

  isConnectedTo(userId: string): boolean {
    const sanitizedId = this.replaceInvalidId(userId)
    return this.peers.has(sanitizedId) || this.onCalledPeers.has(sanitizedId)
  }

  initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        console.log('[WebRTC] Recebendo chamada de:', call.peer)
        const streamToSend = this.myStream || this.createSilentAudioStream()
        call.answer(streamToSend)

        const video = document.createElement('video')
        video.muted = true
        this.onCalledPeers.set(call.peer, { call, video })

        call.on('stream', (userVideoStream) => {
          if (userVideoStream.getVideoTracks().length > 0) {
            this.addVideoStream(video, userVideoStream)
          }
          this.setupRemoteAudio(call.peer, userVideoStream)
        })

        call.on('close', () => {
          this.deleteOnCalledVideoStream(call.peer)
        })

        call.on('error', (err) => {
          console.warn('[WebRTC] Erro na chamada recebida de', call.peer, err)
          this.deleteOnCalledVideoStream(call.peer)
        })
      }
    })
  }

  checkPreviousPermission() {
    const permissionName = 'microphone' as PermissionName
    navigator.permissions?.query({ name: permissionName }).then((result) => {
      if (result.state === 'granted') {
        this.ensureMicrophone()
      }
    }).catch(() => {})
  }

  async ensureMicrophone(): Promise<MediaStream | null> {
    if (this.myStream && this.myStream.getAudioTracks().length > 0) {
      const track = this.myStream.getAudioTracks()[0]
      if (track.readyState === 'live') {
        track.enabled = true
        store.dispatch(setMicMuted(false))
        store.dispatch(setMicrophoneMuted(false))
        return this.myStream
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      this.myStream = stream
      this.setupLocalSpeechDetection(stream)

      store.dispatch(setMicMuted(false))
      store.dispatch(setMicrophoneMuted(false))

      // Atualiza a faixa de áudio em todas as chamadas WebRTC ativas
      this.updateActiveCallsTrack(stream)

      return stream
    } catch (err) {
      console.warn('[WebRTC] Permissao de microfone negada ou indisponivel:', err)
      return null
    }
  }

  private setupLocalSpeechDetection(stream: MediaStream) {
    try {
      const ctx = this.getAudioContext()
      const source = ctx.createMediaStreamSource(stream)
      this.localAnalyser = ctx.createAnalyser()
      this.localAnalyser.fftSize = 256
      source.connect(this.localAnalyser)

      const data = new Uint8Array(this.localAnalyser.frequencyBinCount)
      const checkVolume = () => {
        if (!this.myStream || !this.localAnalyser) return

        const track = this.myStream.getAudioTracks()[0]
        const isMuted = !track || !track.enabled || store.getState().user.microphoneMuted

        if (isMuted) {
          const game = phaserGame.scene.keys.game as any
          game?.myPlayer?.setSpeaking(false)
          requestAnimationFrame(checkVolume)
          return
        }

        this.localAnalyser.getByteFrequencyData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i]
        const avg = sum / data.length
        const isSpeaking = avg > 8

        const game = phaserGame.scene.keys.game as any
        game?.myPlayer?.setSpeaking(isSpeaking)

        requestAnimationFrame(checkVolume)
      }

      requestAnimationFrame(checkVolume)
    } catch (e) {
      console.warn('[WebRTC] Falha ao configurar detector de fala local:', e)
    }
  }

  private updateActiveCallsTrack(stream: MediaStream) {
    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) return

    const updateCall = (item: { call: Peer.MediaConnection }) => {
      try {
        const pc = (item.call as any).peerConnection as RTCPeerConnection | undefined
        if (!pc) return
        const senders = pc.getSenders()
        const audioSender = senders.find((s) => s.track?.kind === 'audio')
        if (audioSender) {
          audioSender.replaceTrack(audioTrack).catch((err) => {
            console.warn('[WebRTC] replaceTrack error:', err)
          })
        } else {
          pc.addTrack(audioTrack, stream)
        }
      } catch (err) {
        console.warn('[WebRTC] Erro ao sincronizar track de audio:', err)
      }
    }

    this.peers.forEach(updateCall)
    this.onCalledPeers.forEach(updateCall)
  }

  getUserMedia(alertOnError = true) {
    navigator.mediaDevices
      ?.getUserMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        this.handleMediaStreamSuccess(stream)
      })
      .catch((err) => {
        console.warn('Webcam+Mic indisponivel, tentando fallback somente áudio...', err)
        navigator.mediaDevices
          ?.getUserMedia({
            video: false,
            audio: true,
          })
          .then((stream) => {
            this.handleMediaStreamSuccess(stream)
          })
          .catch((finalErr) => {
            console.error('Falha ao obter dispositivos de mídia:', finalErr)
            if (alertOnError) {
              window.alert(
                'Nenhum microfone ou webcam foi encontrado, ou a permissão foi negada no navegador.'
              )
            }
          })
      })
  }

  private handleMediaStreamSuccess(stream: MediaStream) {
    this.myStream = stream
    if (stream.getVideoTracks().length > 0) {
      this.addVideoStream(this.myVideo, this.myStream)
    }
    store.dispatch(setVideoConnected(true))
    store.dispatch(setMicMuted(false))
    store.dispatch(setMicrophoneMuted(false))

    const hasVideo = stream.getVideoTracks().length > 0
    store.dispatch(setVideoMuted(!hasVideo))

    this.setupLocalSpeechDetection(stream)
    this.network.videoConnected()
    this.updateActiveCallsTrack(stream)
  }

  setAudioEnabled(enabled: boolean) {
    if (this.myStream) {
      this.myStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled
      })
    }
    store.dispatch(setMicMuted(!enabled))
    store.dispatch(setMicrophoneMuted(!enabled))

    const game = phaserGame.scene.keys.game as any
    if (!enabled) {
      game?.myPlayer?.setSpeaking(false)
    }
  }

  connectToNewUser(userId: string): boolean {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId) || this.onCalledPeers.has(sanitizedId)) {
      return true
    }

    if (!this.isPeerOpen) {
      this.pendingCalls.add(userId)
      return false
    }

    try {
      const streamToSend = this.myStream || this.createSilentAudioStream()
      console.log('[WebRTC] Chamando peer:', sanitizedId)
      const call = this.myPeer.call(sanitizedId, streamToSend)
      if (!call) return false

      const video = document.createElement('video')
      video.muted = true
      this.peers.set(sanitizedId, { call, video })

      call.on('stream', (userVideoStream) => {
        if (userVideoStream.getVideoTracks().length > 0) {
          this.addVideoStream(video, userVideoStream)
        }
        this.setupRemoteAudio(sanitizedId, userVideoStream)
      })

      call.on('close', () => {
        this.deleteVideoStream(sanitizedId)
      })

      call.on('error', (err) => {
        console.warn('[WebRTC] Call error com peer', sanitizedId, err)
        this.deleteVideoStream(sanitizedId)
      })

      return true
    } catch (err) {
      console.warn('[WebRTC] Erro ao chamar peer', sanitizedId, err)
      return false
    }
  }

  setupRemoteAudio(peerId: string, stream: MediaStream) {
    if (stream.getAudioTracks().length === 0) return

    this.removeRemoteAudio(peerId)

    try {
      const audio = new Audio()
      audio.srcObject = stream
      audio.autoplay = true
      audio.volume = 0 // Inicia zerado até primeira atualização de distância

      const playAudio = () => {
        audio.play().catch(() => {
          const unlock = () => {
            audio.play().catch(() => {})
            window.removeEventListener('click', unlock)
            window.removeEventListener('keydown', unlock)
          }
          window.addEventListener('click', unlock)
          window.addEventListener('keydown', unlock)
        })
      }
      playAudio()

      // Detector de fala do jogador remoto para acender o nome em verde
      let analyser: AnalyserNode | undefined
      try {
        const ctx = this.getAudioContext()
        const source = ctx.createMediaStreamSource(stream)
        analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        // Não conecta ao ctx.destination para evitar duplicidade de som
      } catch (e) {
        console.warn('[WebRTC] Não foi possível criar analyser remoto para peer', peerId, e)
      }

      this.peerAudios.set(peerId, { audio, analyser })
      console.log('[WebRTC] Áudio remoto configurado com sucesso para peer:', peerId)
    } catch (e) {
      console.error('[WebRTC] Erro ao configurar áudio remoto para peer:', peerId, e)
    }
  }

  updateSpatialAudio(
    userId: string,
    myX: number,
    myY: number,
    otherX: number,
    otherY: number
  ) {
    const sanitizedId = this.replaceInvalidId(userId)
    const entry = this.peerAudios.get(sanitizedId)
    if (!entry) return

    const dx = otherX - myX
    const dy = otherY - myY
    const distance = Math.hypot(dx, dy)

    const minDistance = 60
    const maxHearingDistance = 450

    let targetVolume = 0
    if (distance <= minDistance) {
      targetVolume = 1.0
    } else if (distance < maxHearingDistance) {
      const factor = (distance - minDistance) / (maxHearingDistance - minDistance)
      // Atenuação suave em cosseno
      targetVolume = Math.cos(factor * (Math.PI / 2))
    } else {
      targetVolume = 0
    }

    if (entry.audio) {
      entry.audio.volume = Math.max(0, Math.min(1, targetVolume))
    }

    // Atualiza nome em verde quando o outro jogador fala
    if (entry.analyser) {
      const data = new Uint8Array(entry.analyser.frequencyBinCount)
      entry.analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const avg = sum / data.length
      const isSpeaking = avg > 8

      const game = phaserGame.scene.keys.game as any
      const other = game?.otherPlayerMap?.get(userId)
      if (other) {
        other.setSpeaking(isSpeaking)
      }
    }
  }

  removeRemoteAudio(peerId: string) {
    const entry = this.peerAudios.get(peerId)
    if (entry) {
      try {
        entry.audio.pause()
        entry.audio.srcObject = null
        entry.audio.remove()
        entry.analyser?.disconnect()
      } catch (err) {}
      this.peerAudios.delete(peerId)
    }
  }

  toggleMute(): boolean {
    if (!this.myStream) {
      this.ensureMicrophone()
      return false
    }
    const audioTrack = this.myStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      const isMuted = !audioTrack.enabled
      store.dispatch(setMicMuted(isMuted))
      store.dispatch(setMicrophoneMuted(isMuted))
      const game = phaserGame.scene.keys.game as any
      if (isMuted) {
        game?.myPlayer?.setSpeaking(false)
      }
      return isMuted
    }
    return false
  }

  toggleVideo(): boolean {
    if (!this.myStream) {
      this.getUserMedia(true)
      return false
    }
    const videoTrack = this.myStream.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled
      const isMuted = !videoTrack.enabled
      store.dispatch(setVideoMuted(isMuted))
      return isMuted
    }
    return false
  }

  addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true
    video.muted = true
    video.addEventListener('loadedmetadata', () => {
      video.play().catch(() => {})
    })
    if (this.videoGrid && !this.videoGrid.contains(video)) {
      this.videoGrid.append(video)
    }
  }

  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      peer?.video.remove()
      this.peers.delete(sanitizedId)
    }
    this.removeRemoteAudio(sanitizedId)
  }

  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      onCalledPeer?.video.remove()
      this.onCalledPeers.delete(sanitizedId)
    }
    this.removeRemoteAudio(sanitizedId)
  }
}
