import Peer from 'peerjs'
import Network from '../services/Network'
import store from '../stores'
import { setVideoConnected, setMicMuted, setVideoMuted } from '../stores/UserStore'

interface PeerAudioNodes {
  source: MediaStreamAudioSourceNode
  filter: BiquadFilterNode
  panner: StereoPannerNode | null
  gain: GainNode
}

export default class WebRTC {
  private myPeer: Peer
  private peers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private onCalledPeers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private peerAudioNodes = new Map<string, PeerAudioNodes>()
  private videoGrid = document.querySelector('.video-grid')
  private myVideo = document.createElement('video')
  private myStream?: MediaStream
  private network: Network
  private audioContext?: AudioContext

  constructor(userId: string, network: Network) {
    const sanitizedId = this.replaceInvalidId(userId)
    this.myPeer = new Peer(sanitizedId)
    this.network = network

    this.myPeer.on('error', (err) => {
      console.warn('PeerJS error:', err.type, err)
    })

    // Mute own video element (never listen to yourself)
    this.myVideo.muted = true

    // Resume AudioContext on any user interaction with the window
    window.addEventListener(
      'click',
      () => {
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {})
        }
      },
      { passive: true }
    )

    this.initialize()
  }

  getAudioContext(): AudioContext {
    if (!this.audioContext) {
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

  initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        call.answer(this.myStream)
        const video = document.createElement('video')
        // Remote video elements are muted because Web Audio spatial audio handles playback
        video.muted = true
        this.onCalledPeers.set(call.peer, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
          this.setupSpatialAudio(call.peer, userVideoStream)
        })
      }
    })
  }

  // Check if permission has been granted before
  checkPreviousPermission() {
    const permissionName = 'microphone' as PermissionName
    navigator.permissions?.query({ name: permissionName }).then((result) => {
      if (result.state === 'granted') this.getUserMedia(false)
    })
  }

  getUserMedia(alertOnError = true) {
    // 1. Try requesting both video and audio
    navigator.mediaDevices
      ?.getUserMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        this.handleMediaStreamSuccess(stream)
      })
      .catch((err) => {
        console.warn('Webcam+Mic unavailable or denied, attempting Audio only fallback...', err)
        // 2. Fallback to audio only (ideal for desktops without webcam)
        navigator.mediaDevices
          ?.getUserMedia({
            video: false,
            audio: true,
          })
          .then((stream) => {
            this.handleMediaStreamSuccess(stream)
          })
          .catch((finalErr) => {
            console.error('Failed to get media devices:', finalErr)
            if (alertOnError) {
              window.alert(
                'Nenhum microfone ou webcam foi encontrado, ou a permissão foi negada no navegador.\nVerifique as permissões de mídia do seu navegador.'
              )
            }
          })
      })
  }

  private handleMediaStreamSuccess(stream: MediaStream) {
    this.myStream = stream
    this.addVideoStream(this.myVideo, this.myStream)
    store.dispatch(setVideoConnected(true))
    store.dispatch(setMicMuted(false))

    const hasVideo = stream.getVideoTracks().length > 0
    store.dispatch(setVideoMuted(!hasVideo))

    this.network.videoConnected()
  }

  // Call a peer
  connectToNewUser(userId: string) {
    if (this.myStream) {
      const sanitizedId = this.replaceInvalidId(userId)
      if (!this.peers.has(sanitizedId)) {
        const call = this.myPeer.call(sanitizedId, this.myStream)
        const video = document.createElement('video')
        video.muted = true
        this.peers.set(sanitizedId, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
          this.setupSpatialAudio(sanitizedId, userVideoStream)
        })
      }
    }
  }

  // Setup Web Audio API node chain for 3D positional audio and acoustic depth
  setupSpatialAudio(peerId: string, stream: MediaStream) {
    if (stream.getAudioTracks().length === 0) return

    const ctx = this.getAudioContext()
    this.removeSpatialAudio(peerId)

    try {
      const source = ctx.createMediaStreamSource(stream)

      // Acoustic filter for depth (muffles sound naturally as distance increases)
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(20000, ctx.currentTime)

      // Stereo Panner for left/right positional audio
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null

      // Gain node for physical distance attenuation (proximity)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(1, ctx.currentTime)

      // Connect graph: source -> filter -> panner? -> gain -> speakers
      source.connect(filter)
      if (panner) {
        filter.connect(panner)
        panner.connect(gain)
      } else {
        filter.connect(gain)
      }
      gain.connect(ctx.destination)

      this.peerAudioNodes.set(peerId, { source, filter, panner, gain })
    } catch (e) {
      console.warn('Failed to configure spatial audio for peer', peerId, e)
    }
  }

  // Smoothly update volume, stereo position and depth based on distance and coordinates
  updateSpatialAudio(
    userId: string,
    myX: number,
    myY: number,
    otherX: number,
    otherY: number
  ) {
    const sanitizedId = this.replaceInvalidId(userId)
    const nodes = this.peerAudioNodes.get(sanitizedId)
    if (!nodes || !this.audioContext) return

    const dx = otherX - myX
    const dy = otherY - myY
    const distance = Math.hypot(dx, dy)

    const minDistance = 50
    const maxDistance = 420
    const now = this.audioContext.currentTime

    // 1. Proximidade (Volume com atenuação física suave)
    let targetGain = 0
    if (distance <= minDistance) {
      targetGain = 1.0
    } else if (distance < maxDistance) {
      const factor = (distance - minDistance) / (maxDistance - minDistance)
      // Cosine roll-off acústico para transição suave e realista
      targetGain = Math.cos(factor * (Math.PI / 2))
    } else {
      targetGain = 0
    }
    nodes.gain.gain.setTargetAtTime(targetGain, now, 0.05)

    // 2. Posicionamento Estéreo (Esquerda / Direita)
    if (nodes.panner) {
      const maxPanDistance = 280
      const pan = Math.max(-1, Math.min(1, dx / maxPanDistance))
      nodes.panner.pan.setTargetAtTime(pan, now, 0.05)
    }

    // 3. Profundidade Acústica (Atenuação de frequências com distância e profundidade do mapa)
    const depthFactor = Math.min(1, distance / maxDistance)
    const targetFreq = 20000 - depthFactor * 16800 // De 20.000 Hz até 3.200 Hz
    nodes.filter.frequency.setTargetAtTime(targetFreq, now, 0.05)
  }

  removeSpatialAudio(peerId: string) {
    const nodes = this.peerAudioNodes.get(peerId)
    if (nodes) {
      try {
        nodes.source.disconnect()
        nodes.filter.disconnect()
        nodes.panner?.disconnect()
        nodes.gain.disconnect()
      } catch (err) {
        console.warn('Error disconnecting audio nodes:', err)
      }
      this.peerAudioNodes.delete(peerId)
    }
  }

  // Toggle microphone mute
  toggleMute(): boolean {
    if (!this.myStream) {
      this.getUserMedia(true)
      return false
    }
    const audioTrack = this.myStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      const isMuted = !audioTrack.enabled
      store.dispatch(setMicMuted(isMuted))
      return isMuted
    }
    return false
  }

  // Toggle video on/off
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

  // Method to add video stream to videoGrid div
  addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true
    video.addEventListener('loadedmetadata', () => {
      video.play().catch(() => {})
    })
    if (this.videoGrid && !this.videoGrid.contains(video)) {
      this.videoGrid.append(video)
    }
  }

  // Method to remove video stream (when we are the host of the call)
  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      peer?.video.remove()
      this.peers.delete(sanitizedId)
    }
    this.removeSpatialAudio(sanitizedId)
  }

  // Method to remove video stream (when we are the guest of the call)
  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      onCalledPeer?.video.remove()
      this.onCalledPeers.delete(sanitizedId)
    }
    this.removeSpatialAudio(sanitizedId)
  }
}
