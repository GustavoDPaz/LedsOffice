import Peer from 'peerjs'
import Network from '../services/Network'
import store from '../stores'
import { setVideoConnected } from '../stores/UserStore'
import { proximityAudio } from './ProximityAudio'

export default class WebRTC {
  private myPeer: Peer
  private peers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private onCalledPeers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private videoGrid = document.querySelector('.video-grid')
  private buttonGrid = document.querySelector('.button-grid')
  private myVideo = document.createElement('video')
  private myStream?: MediaStream
  private audioStream?: MediaStream
  private network: Network

  constructor(userId: string, network: Network) {
    const sanitizedId = this.replaceInvalidId(userId)
    this.myPeer = new Peer(sanitizedId)
    this.network = network
    console.log('userId:', userId)
    console.log('sanitizedId:', sanitizedId)
    this.myPeer.on('error', (err) => {
      console.log(err.type)
      console.error(err)
    })

    // mute your own video stream (you don't want to hear yourself)
    this.myVideo.muted = true

    // config peerJS
    this.initialize()
  }

  // PeerJS throws invalid_id error if it contains some characters such as that colyseus generates.
  // https://peerjs.com/docs.html#peer-id
  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        const streamToSend =
          this.myStream || this.audioStream || proximityAudio.getMicStream() || new MediaStream()
        call.answer(streamToSend)
        const video = document.createElement('video')
        this.onCalledPeers.set(call.peer, { call, video })

        call.on('stream', (userVideoStream) => {
          if (userVideoStream.getVideoTracks().length > 0) {
            this.addVideoStream(video, userVideoStream)
          }
          proximityAudio.attachRemoteStream(call.peer, userVideoStream)
        })
      }
      // on close is triggered manually with deleteOnCalledVideoStream()
    })
  }

  // check if permission has been granted before
  checkPreviousPermission() {
    const permissionName = 'microphone' as PermissionName
    navigator.permissions?.query({ name: permissionName }).then((result) => {
      if (result.state === 'granted') this.getUserMedia(false)
    })
  }

  getUserMedia(alertOnError = true) {
    // ask the browser to get user media
    navigator.mediaDevices
      ?.getUserMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        this.myStream = stream
        this.addVideoStream(this.myVideo, this.myStream)
        this.setUpButtons()
        store.dispatch(setVideoConnected(true))
        this.network.videoConnected()
        this.setAudioStream(stream)
      })
      .catch((error) => {
        if (alertOnError) window.alert('No webcam or microphone found, or permission is blocked')
      })
  }

  setAudioStream(stream: MediaStream | null) {
    this.audioStream = stream || undefined
    const audioTrack = stream && stream.getAudioTracks().length > 0 ? stream.getAudioTracks()[0] : null

    const updateCall = (item: { call: Peer.MediaConnection }) => {
      try {
        const pc = (item.call as any).peerConnection as RTCPeerConnection | undefined
        if (!pc) return
        const senders = pc.getSenders()
        const audioSender = senders.find((s) => s.track?.kind === 'audio')
        if (audioSender) {
          audioSender.replaceTrack(audioTrack)
        } else if (audioTrack && stream) {
          pc.addTrack(audioTrack, stream)
        }
      } catch (err) {
        console.warn('[WebRTC] Erro ao sincronizar track de áudio:', err)
      }
    }

    this.peers.forEach(updateCall)
    this.onCalledPeers.forEach(updateCall)
  }

  // method to call a peer
  connectToNewUser(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (!this.peers.has(sanitizedId)) {
      console.log('calling', sanitizedId)
      const streamToSend =
        this.myStream || this.audioStream || proximityAudio.getMicStream() || new MediaStream()
      const call = this.myPeer.call(sanitizedId, streamToSend)
      const video = document.createElement('video')
      this.peers.set(sanitizedId, { call, video })

      call.on('stream', (userVideoStream) => {
        if (userVideoStream.getVideoTracks().length > 0) {
          this.addVideoStream(video, userVideoStream)
        }
        proximityAudio.attachRemoteStream(sanitizedId, userVideoStream)
        proximityAudio.attachRemoteStream(userId, userVideoStream)
      })

      // on close is triggered manually with deleteVideoStream()
    }
  }

  // method to add new video stream to videoGrid div
  addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true
    // Impede o elemento HTML de áudio/vídeo de vazar som a 100% sem efeito espacial 3D
    video.muted = true
    video.addEventListener('loadedmetadata', () => {
      video.play()
    })
    if (this.videoGrid) this.videoGrid.append(video)
  }

  // method to remove video stream (when we are the host of the call)
  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      peer?.video.remove()
      this.peers.delete(sanitizedId)
      proximityAudio.removeSource(sanitizedId)
      proximityAudio.removeSource(userId)
    }
  }

  // method to remove video stream (when we are the guest of the call)
  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      onCalledPeer?.video.remove()
      this.onCalledPeers.delete(sanitizedId)
      proximityAudio.removeSource(sanitizedId)
      proximityAudio.removeSource(userId)
    }
  }

  setAudioEnabled(enabled: boolean) {
    if (this.myStream) {
      this.myStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled
      })
    }
    if (this.audioStream) {
      this.audioStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled
      })
    }
    proximityAudio.setMicrophoneMuted(!enabled)
    const audioButton = this.buttonGrid?.querySelector('.audio-btn') as HTMLButtonElement | null
    if (audioButton) {
      audioButton.innerText = enabled ? 'Mute' : 'Unmute'
    }
  }

  isAudioEnabled(): boolean {
    const stream = this.audioStream || this.myStream || proximityAudio.getMicStream()
    if (!stream) return false
    const track = stream.getAudioTracks()[0]
    return track ? track.enabled : false
  }

  toggleAudio(): boolean {
    const nextState = !this.isAudioEnabled()
    this.setAudioEnabled(nextState)
    return nextState
  }

  // method to set up mute/unmute and video on/off buttons
  setUpButtons() {
    const audioButton = document.createElement('button')
    audioButton.className = 'audio-btn'
    audioButton.innerText = this.isAudioEnabled() ? 'Mute' : 'Unmute'
    audioButton.addEventListener('click', () => {
      this.toggleAudio()
    })
    const videoButton = document.createElement('button')
    videoButton.innerText = 'Video off'
    videoButton.addEventListener('click', () => {
      if (this.myStream) {
        const audioTrack = this.myStream.getVideoTracks()[0]
        if (audioTrack.enabled) {
          audioTrack.enabled = false
          videoButton.innerText = 'Video on'
        } else {
          audioTrack.enabled = true
          videoButton.innerText = 'Video off'
        }
      }
    })
    this.buttonGrid?.append(audioButton)
    this.buttonGrid?.append(videoButton)
  }
}
