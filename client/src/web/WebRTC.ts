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
  private visibleVideos = new Set<string>()

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

    // Muta o próprio elemento de vídeo para não reproduzir o próprio áudio
    this.myVideo.muted = true
    this.myVideo.playsInline = true

    // Resume AudioContext na primeira interação com a página
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

  // O PeerJS exige IDs alfanuméricos simples
  replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  private getVideoGrid(): HTMLDivElement | null {
    if (!this.videoGrid || !document.body.contains(this.videoGrid)) {
      this.videoGrid = document.querySelector('.video-grid')
    }
    return this.videoGrid as HTMLDivElement | null
  }

  // Cria uma faixa de vídeo vazia para registrar transceivers de vídeo desde o handshake inicial
  createBlankVideoTrack(): MediaStreamTrack | null {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#1c2032'
        ctx.fillRect(0, 0, 16, 16)
      }
      const stream = (canvas as any).captureStream ? (canvas as any).captureStream(1) : null
      if (stream && stream.getVideoTracks().length > 0) {
        const track = stream.getVideoTracks()[0]
        track.enabled = false
        return track
      }
    } catch (e) {
      console.warn('[WebRTC] Falha ao criar blank video track:', e)
    }
    return null
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

  // Retorna o stream para envio em chamadas, garantindo que contenha faixas de áudio e vídeo
  getStreamToSend(): MediaStream {
    if (this.myStream) {
      if (this.myStream.getVideoTracks().length === 0) {
        const blankTrack = this.createBlankVideoTrack()
        if (blankTrack) {
          this.myStream.addTrack(blankTrack)
        }
      }
      return this.myStream
    }

    const stream = this.createSilentAudioStream()
    const blankTrack = this.createBlankVideoTrack()
    if (blankTrack) {
      stream.addTrack(blankTrack)
    }
    return stream
  }

  isConnectedTo(userId: string): boolean {
    const sanitizedId = this.replaceInvalidId(userId)
    return this.peers.has(sanitizedId) || this.onCalledPeers.has(sanitizedId)
  }

  initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        console.log('[WebRTC] Recebendo chamada de:', call.peer)
        const streamToSend = this.getStreamToSend()
        call.answer(streamToSend)

        const video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.autoplay = true
        this.onCalledPeers.set(call.peer, { call, video })

        call.on('stream', (userVideoStream) => {
          video.srcObject = userVideoStream
          video.play().catch(() => {})
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

      // Se já existia um stream com vídeo, preserva a faixa de vídeo
      if (this.myStream) {
        const oldVideoTracks = this.myStream.getVideoTracks()
        oldVideoTracks.forEach((vt) => stream.addTrack(vt))
      }

      this.myStream = stream
      this.setupLocalSpeechDetection(stream)

      store.dispatch(setMicMuted(false))
      store.dispatch(setMicrophoneMuted(false))

      // Atualiza a faixa de áudio em todas as chamadas ativas
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

  // Sincroniza dinamicamente as faixas de áudio E de vídeo em todas as chamadas WebRTC ativas
  private updateActiveCallsTrack(stream: MediaStream) {
    const audioTrack = stream.getAudioTracks().find((t) => t.readyState === 'live')
    const videoTrack = stream.getVideoTracks().find((t) => t.readyState === 'live')

    const updateCall = (item: { call: Peer.MediaConnection; video: HTMLVideoElement }) => {
      try {
        const pc = (item.call as any).peerConnection as RTCPeerConnection | undefined
        if (!pc) return
        const senders = pc.getSenders()

        // 1. Sincroniza áudio
        if (audioTrack) {
          const audioSender = senders.find((s) => s.track?.kind === 'audio')
          if (audioSender) {
            audioSender.replaceTrack(audioTrack).catch((err) => {
              console.warn('[WebRTC] replaceTrack audio error:', err)
            })
          } else {
            try {
              pc.addTrack(audioTrack, stream)
            } catch (e) {}
          }
        }

        // 2. Sincroniza vídeo (permite ligar e desligar a webcam em chamadas já conectadas)
        if (videoTrack) {
          const videoSender = senders.find((s) => s.track?.kind === 'video')
          if (videoSender) {
            videoSender.replaceTrack(videoTrack).catch((err) => {
              console.warn('[WebRTC] replaceTrack video error:', err)
            })
          } else {
            try {
              pc.addTrack(videoTrack, stream)
            } catch (e) {}
          }
        }
      } catch (err) {
        console.warn('[WebRTC] Erro ao sincronizar tracks:', err)
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
    const hasLiveVideo = stream.getVideoTracks().some((t) => t.readyState === 'live')

    store.dispatch(setVideoConnected(true))
    store.dispatch(setMicMuted(false))
    store.dispatch(setMicrophoneMuted(false))
    store.dispatch(setVideoMuted(!hasLiveVideo))

    const grid = this.getVideoGrid()
    if (grid && hasLiveVideo) {
      if (!grid.contains(this.myVideo)) {
        this.addVideoStream(this.myVideo, this.myStream)
      }
    }

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
      const streamToSend = this.getStreamToSend()
      console.log('[WebRTC] Chamando peer:', sanitizedId)
      const call = this.myPeer.call(sanitizedId, streamToSend)
      if (!call) return false

      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.autoplay = true
      this.peers.set(sanitizedId, { call, video })

      call.on('stream', (userVideoStream) => {
        video.srcObject = userVideoStream
        video.play().catch(() => {})
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
      } catch (e) {
        console.warn('[WebRTC] Não foi possível criar analyser remoto para peer', peerId, e)
      }

      this.peerAudios.set(peerId, { audio, analyser })
      console.log('[WebRTC] Áudio remoto configurado com sucesso para peer:', peerId)
    } catch (e) {
      console.error('[WebRTC] Erro ao configurar áudio remoto para peer:', peerId, e)
    }
  }

  // Atualiza áudio espacial e gerencia visibilidade de vídeo por PROXIMIDADE
  updateSpatialAudio(
    userId: string,
    myX: number,
    myY: number,
    otherX: number,
    otherY: number
  ) {
    const sanitizedId = this.replaceInvalidId(userId)
    const audioEntry = this.peerAudios.get(sanitizedId)

    const dx = otherX - myX
    const dy = otherY - myY
    const distance = Math.hypot(dx, dy)

    // 1. Áudio espacial com atenuação suave até 450px
    const minDistance = 60
    const maxHearingDistance = 450

    let targetVolume = 0
    if (distance <= minDistance) {
      targetVolume = 1.0
    } else if (distance < maxHearingDistance) {
      const factor = (distance - minDistance) / (maxHearingDistance - minDistance)
      targetVolume = Math.cos(factor * (Math.PI / 2))
    } else {
      targetVolume = 0
    }

    if (audioEntry?.audio) {
      audioEntry.audio.volume = Math.max(0, Math.min(1, targetVolume))
    }

    // 2. Indicador de fala no nome do jogador remoto
    if (audioEntry?.analyser) {
      const data = new Uint8Array(audioEntry.analyser.frequencyBinCount)
      audioEntry.analyser.getByteFrequencyData(data)
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

    // 3. PROXIMIDADE DA CÂMERA (VÍDEO)
    // A câmera só aparece na grade se os jogadores estiverem próximos (raio de conversa)
    const videoEntry = this.peers.get(sanitizedId) || this.onCalledPeers.get(sanitizedId)
    if (videoEntry) {
      const isCurrentlyVisible = this.visibleVideos.has(sanitizedId)
      // Histerese de distância: entra em <= 180px, sai ao ultrapassar 210px
      const inVisualRange = isCurrentlyVisible ? distance <= 210 : distance <= 180

      const game = phaserGame.scene.keys.game as any
      const other = game?.otherPlayerMap?.get(userId)
      const remoteHasCamera = Boolean(other?.videoConnected)
      const remoteStream = videoEntry.video.srcObject as MediaStream | null
      const liveVideoTrack = remoteStream?.getVideoTracks().find((t) => t.readyState === 'live')
      const remoteTrackActive = Boolean(liveVideoTrack && liveVideoTrack.enabled)

      const shouldShow = inVisualRange && (remoteHasCamera || remoteTrackActive)

      if (shouldShow !== isCurrentlyVisible) {
        if (shouldShow) {
          this.visibleVideos.add(sanitizedId)
          this.showRemoteVideo(videoEntry.video)
        } else {
          this.visibleVideos.delete(sanitizedId)
          this.hideRemoteVideo(videoEntry.video)
        }
      }
    }
  }

  private showRemoteVideo(video: HTMLVideoElement) {
    const grid = this.getVideoGrid()
    if (!grid) return
    if (!grid.contains(video)) {
      grid.appendChild(video)
    }
    video.style.display = 'block'
    if (video.paused && video.srcObject) {
      video.play().catch(() => {})
    }
  }

  private hideRemoteVideo(video: HTMLVideoElement) {
    const grid = this.getVideoGrid()
    if (grid && grid.contains(video)) {
      grid.removeChild(video)
    }
    video.style.display = 'none'
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
    const audioTrack = this.myStream.getAudioTracks().find((t) => t.readyState === 'live')
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
    const videoTrack = this.myStream.getVideoTracks().find((t) => t.readyState === 'live')
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled
      const isMuted = !videoTrack.enabled
      store.dispatch(setVideoMuted(isMuted))

      const grid = this.getVideoGrid()
      if (grid) {
        if (isMuted) {
          if (grid.contains(this.myVideo)) {
            grid.removeChild(this.myVideo)
          }
        } else {
          if (!grid.contains(this.myVideo)) {
            grid.prepend(this.myVideo)
          }
          this.myVideo.play().catch(() => {})
        }
      }

      this.updateActiveCallsTrack(this.myStream)
      return isMuted
    } else {
      // Se não havia faixa de vídeo no stream, solicita permissão para capturar webcam
      this.getUserMedia(true)
      return false
    }
  }

  addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true
    video.muted = true
    video.addEventListener('loadedmetadata', () => {
      video.play().catch(() => {})
    })
    const grid = this.getVideoGrid()
    if (grid && !grid.contains(video)) {
      grid.append(video)
    }
  }

  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    this.visibleVideos.delete(sanitizedId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      if (peer?.video) {
        this.hideRemoteVideo(peer.video)
        peer.video.remove()
      }
      this.peers.delete(sanitizedId)
    }
    this.removeRemoteAudio(sanitizedId)
  }

  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    this.visibleVideos.delete(sanitizedId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      if (onCalledPeer?.video) {
        this.hideRemoteVideo(onCalledPeer.video)
        onCalledPeer.video.remove()
      }
      this.onCalledPeers.delete(sanitizedId)
    }
    this.removeRemoteAudio(sanitizedId)
  }
}
