export class ProximityAudioManager {
  private ctx: AudioContext | null = null
  private soundGenerators: Map<
    string,
    {
      gain: GainNode
      panner: StereoPannerNode
      source?: AudioNode
      dummyAudio?: HTMLAudioElement
      extraNodes?: AudioNode[]
    }
  > = new Map()
  private maxHearingDistance: number = 360 // Raio em pixels
  private micStream: MediaStream | null = null
  private micSourceNode: MediaStreamAudioSourceNode | null = null
  private micAnalyser: AnalyserNode | null = null
  private isListeningMic: boolean = false

  // Rádio ambiente contínuo para teste espacial
  private radioState: {
    gain: GainNode
    panner: StereoPannerNode
    timer: number | null
    x: number
    y: number
    isPlaying: boolean
  } | null = null

  constructor(maxDistance: number = 360) {
    this.maxHearingDistance = maxDistance
  }

  public async init(): Promise<AudioContext> {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AudioCtx()
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    return this.ctx
  }

  public getMicStream(): MediaStream | null {
    return this.micStream
  }

  /**
   * Conecta um stream de áudio remoto recebido via WebRTC a um nó de espacialização e ganho por distância
   */
  public async attachRemoteStream(peerId: string, stream: MediaStream) {
    await this.init()
    if (!this.ctx) return

    this.removeSource(peerId)

    try {
      // Cria elemento de áudio oculto e MUTADO para forçar o Chromium a decodificar o stream WebRTC sem tocar em 100% no master
      const dummyAudio = new Audio()
      dummyAudio.srcObject = stream
      dummyAudio.muted = true // IMPEDE VAZAMENTO A 100% NO NAVEGADOR
      dummyAudio.play().catch(() => {})

      const source = this.ctx.createMediaStreamSource(stream)
      const gain = this.ctx.createGain()
      const panner = this.ctx.createStereoPanner()

      gain.gain.setValueAtTime(0, this.ctx.currentTime) // Inicia mutado até posicionar

      source.connect(gain)
      gain.connect(panner)
      panner.connect(this.ctx.destination)

      this.soundGenerators.set(peerId, { gain, panner, source, dummyAudio })
      console.log(`[Audio] Stream remoto do colega ${peerId} conectado ao motor de áudio 3D.`)
    } catch (err) {
      console.error('[Audio] Erro ao conectar stream remoto:', err)
    }
  }

  /**
   * Ativa o microfone do usuário e monitora o nível de fala (Volume Energy)
   */
  public async enableMicrophone(
    onVolumeChange?: (volume: number, isSpeaking: boolean) => void
  ): Promise<boolean> {
    try {
      await this.init()
      if (!this.ctx) return false

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      this.micSourceNode = this.ctx.createMediaStreamSource(this.micStream)
      this.micAnalyser = this.ctx.createAnalyser()
      this.micAnalyser.fftSize = 256
      this.micSourceNode.connect(this.micAnalyser)

      this.isListeningMic = true
      const dataArray = new Uint8Array(this.micAnalyser.frequencyBinCount)

      const checkVolume = () => {
        if (!this.isListeningMic || !this.micAnalyser) return

        if (this.isMicrophoneMuted()) {
          if (onVolumeChange) {
            onVolumeChange(0, false)
          }
          requestAnimationFrame(checkVolume)
          return
        }

        this.micAnalyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length
        const normalized = Math.min(1, avg / 50)
        const isSpeaking = normalized > 0.12
        if (onVolumeChange) {
          onVolumeChange(normalized, isSpeaking)
        }
        requestAnimationFrame(checkVolume)
      }

      checkVolume()
      return true
    } catch (err) {
      console.warn('[Audio] Não foi possível acessar o microfone ou permissão negada:', err)
      return false
    }
  }

  public isMicrophoneMuted(): boolean {
    if (!this.micStream) return true
    const track = this.micStream.getAudioTracks()[0]
    return !track || !track.enabled
  }

  public setMicrophoneMuted(muted: boolean): boolean {
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted
      })
    }
    return this.isMicrophoneMuted()
  }

  public toggleMicrophoneMuted(): boolean {
    return this.setMicrophoneMuted(!this.isMicrophoneMuted())
  }

  public disableMicrophone() {
    this.isListeningMic = false
    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect()
      } catch (_) {}
      this.micSourceNode = null
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop())
      this.micStream = null
    }
  }

  /**
   * Conecta o microfone local ao clone com atraso de exatamente 1.0 segundo (Loopback Echo)
   * O áudio emitido pelo clone é espacializado pela posição 3D no mapa
   */
  public async attachCloneEcho(
    cloneId: string,
    cloneX: number,
    cloneY: number,
    myX: number,
    myY: number,
    inSamePrivateZone: boolean = false,
    onEchoSpeaking?: (isSpeaking: boolean) => void
  ): Promise<boolean> {
    await this.init()
    if (!this.ctx) return false

    // Se o microfone não estiver aberto, ativa agora
    if (!this.micStream || !this.micStream.active) {
      const ok = await this.enableMicrophone()
      if (!ok) return false
    }

    this.removeSource(cloneId)

    if (!this.micSourceNode && this.micStream) {
      this.micSourceNode = this.ctx.createMediaStreamSource(this.micStream)
    }

    if (!this.micSourceNode) return false

    // 1. Nó de Atraso (DelayNode) configurado para 1.0 segundo
    const delayNode = this.ctx.createDelay(5.0)
    delayNode.delayTime.setValueAtTime(1.0, this.ctx.currentTime)

    // 2. Analisador para detectar quando o eco atrasado está saindo
    const echoAnalyser = this.ctx.createAnalyser()
    echoAnalyser.fftSize = 256

    // 3. Panner e Ganho 3D do Clone
    const panner = this.ctx.createStereoPanner()
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, this.ctx.currentTime)

    // Encadeamento:
    // micSourceNode -> delayNode (1s) -> echoAnalyser -> panner -> gain -> destination
    this.micSourceNode.connect(delayNode)
    delayNode.connect(echoAnalyser)
    echoAnalyser.connect(panner)
    panner.connect(gain)
    gain.connect(this.ctx.destination)

    this.soundGenerators.set(cloneId, {
      gain,
      panner,
      source: delayNode,
      extraNodes: [delayNode, echoAnalyser],
    })

    this.updateSourcePosition(cloneId, cloneX, cloneY, myX, myY, inSamePrivateZone)

    if (onEchoSpeaking) {
      const data = new Uint8Array(echoAnalyser.frequencyBinCount)
      let active = true

      const checkEchoEnergy = () => {
        if (!this.soundGenerators.has(cloneId)) {
          active = false
          return
        }
        echoAnalyser.getByteFrequencyData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i]
        const avg = sum / data.length
        onEchoSpeaking(avg > 8)
        if (active) requestAnimationFrame(checkEchoEnergy)
      }
      requestAnimationFrame(checkEchoEnergy)
    }

    console.log(`[Audio] Clone de eco ${cloneId} ativo com atraso de 1.0 segundo.`)
    return true
  }

  /**
   * Atualiza a posição de uma fonte de áudio relativa ao jogador local
   */
  public updateSourcePosition(
    sourceId: string,
    sourceX: number,
    sourceY: number,
    myX: number,
    myY: number,
    inSamePrivateZone: boolean = false
  ) {
    if (!this.ctx) return

    const dx = sourceX - myX
    const dy = sourceY - myY
    const distance = Math.sqrt(dx * dx + dy * dy)

    let volume = 0
    let pan = 0

    if (inSamePrivateZone) {
      // Dentro de sala fechada com isolamento acústico ativo
      volume = 1.0
      pan = Math.max(-1, Math.min(1, dx / 250))
    } else if (distance < this.maxHearingDistance) {
      // Decaimento suave com a distância
      const ratio = 1 - distance / this.maxHearingDistance
      volume = Math.max(0, Math.min(1, ratio))
      // Panorâmica estéreo (-1 fone esquerdo, +1 fone direito)
      pan = Math.max(-1, Math.min(1, dx / (this.maxHearingDistance * 0.75)))
    } else {
      volume = 0 // Fora do raio
    }

    const sound = this.soundGenerators.get(sourceId)
    if (sound) {
      sound.gain.gain.cancelScheduledValues(this.ctx.currentTime)
      sound.gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + 0.05)
      sound.panner.pan.cancelScheduledValues(this.ctx.currentTime)
      sound.panner.pan.linearRampToValueAtTime(pan, this.ctx.currentTime + 0.05)
    }
  }

  /**
   * Ativa ou desativa o Rádio Lo-Fi contínuo do Lounge para testar aproximação em tempo real
   */
  public async toggleRadioBeacon(
    x: number = 240,
    y: number = 160,
    myX: number = 600,
    myY: number = 650
  ): Promise<boolean> {
    await this.init()
    if (!this.ctx) return false

    if (this.radioState && this.radioState.isPlaying) {
      // Desliga
      if (this.radioState.timer) clearInterval(this.radioState.timer)
      this.radioState.gain.disconnect()
      this.radioState.panner.disconnect()
      this.radioState = null
      return false
    }

    // Liga rádio
    const gain = this.ctx.createGain()
    const panner = this.ctx.createStereoPanner()

    gain.connect(panner)
    panner.connect(this.ctx.destination)

    // Notas de lounge jazz relaxante (Pentatônica suave)
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]
    let noteIdx = 0

    const playNextNote = () => {
      if (!this.ctx || !this.radioState?.isPlaying) return
      const freq = scale[noteIdx % scale.length]
      noteIdx++

      const osc = this.ctx.createOscillator()
      const noteGain = this.ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime)

      noteGain.gain.setValueAtTime(0.4, this.ctx.currentTime)
      noteGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.45)

      osc.connect(noteGain)
      noteGain.connect(gain)

      osc.start()
      osc.stop(this.ctx.currentTime + 0.5)
    }

    const timer = window.setInterval(playNextNote, 500)

    this.radioState = {
      gain,
      panner,
      timer,
      x,
      y,
      isPlaying: true,
    }

    // Atualiza volume e pan inicial
    this.updateRadioPosition(myX, myY)
    playNextNote()
    return true
  }

  public updateRadioPosition(myX: number, myY: number) {
    if (!this.ctx || !this.radioState || !this.radioState.isPlaying) return

    const dx = this.radioState.x - myX
    const dy = this.radioState.y - myY
    const dist = Math.sqrt(dx * dx + dy * dy)

    let volume = 0
    let pan = 0

    if (dist < this.maxHearingDistance) {
      const ratio = 1 - dist / this.maxHearingDistance
      volume = Math.max(0, Math.min(1, ratio))
      pan = Math.max(-1, Math.min(1, dx / (this.maxHearingDistance * 0.75)))
    } else {
      volume = 0
    }

    this.radioState.gain.gain.cancelScheduledValues(this.ctx.currentTime)
    this.radioState.gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + 0.05)
    this.radioState.panner.pan.cancelScheduledValues(this.ctx.currentTime)
    this.radioState.panner.pan.linearRampToValueAtTime(pan, this.ctx.currentTime + 0.05)
  }

  public isRadioPlaying(): boolean {
    return Boolean(this.radioState?.isPlaying)
  }

  /**
   * Toca um teste estéreo nítido e imediato (Som esquerdo, centro, direito) para o usuário validar os fones
   */
  public async playTestStereoSequence(): Promise<void> {
    await this.init()
    if (!this.ctx) return

    const playTone = (freq: number, pan: number, delayMs: number) => {
      setTimeout(() => {
        if (!this.ctx) return
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        const panner = this.ctx.createStereoPanner()

        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime)

        panner.pan.setValueAtTime(pan, this.ctx.currentTime)
        gain.gain.setValueAtTime(0.4, this.ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35)

        osc.connect(gain)
        gain.connect(panner)
        panner.connect(this.ctx.destination)

        osc.start()
        osc.stop(this.ctx.currentTime + 0.36)
      }, delayMs)
    }

    // Tom 1: Lado esquerdo (440Hz - Lá)
    playTone(440, -0.9, 0)
    // Tom 2: Centro (554Hz - Dó#)
    playTone(554, 0, 300)
    // Tom 3: Lado direito (659Hz - Mi)
    playTone(659, 0.9, 600)
  }

  /**
   * Executa fala contínua para um bot, roteada 100% pelo nó Gain/Panner do bot.
   * Conforme o jogador se move com WASD durante a fala, o volume e pan atualizam em tempo real!
   */
  public async playBotSpeech(
    botId: string,
    text: string,
    botX: number,
    botY: number,
    getPlayerPos: () => { x: number; y: number },
    inSameZone: boolean = false
  ) {
    await this.init()
    if (!this.ctx) return

    // 1. Assegura que o bot possui seu próprio nó de áudio espacializado no soundGenerators
    let botSound = this.soundGenerators.get(botId)
    if (!botSound) {
      const gain = this.ctx.createGain()
      const panner = this.ctx.createStereoPanner()
      gain.connect(panner)
      panner.connect(this.ctx.destination)
      botSound = { gain, panner }
      this.soundGenerators.set(botId, botSound)
    }

    // Atualiza imediatamente a posição inicial
    const initPos = getPlayerPos()
    this.updateSourcePosition(botId, botX, botY, initPos.x, initPos.y, inSameZone)

    // 2. Sílabas vocais geradas dentro do Web Audio API e CONECTADAS ao Gain/Panner do bot
    const syllableCount = 20
    const basePitches = [160, 175, 196, 175, 160, 185, 210, 196, 160, 175, 185, 160]
    const formants = [700, 1200, 1800, 900, 1500]

    for (let i = 0; i < syllableCount; i++) {
      setTimeout(() => {
        if (!this.ctx || !botSound) return

        const pitch = basePitches[i % basePitches.length]
        const formantFreq = formants[i % formants.length]

        const osc = this.ctx.createOscillator()
        const formantFilter = this.ctx.createBiquadFilter()
        const syllableGain = this.ctx.createGain()

        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(pitch, this.ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(pitch * 0.95, this.ctx.currentTime + 0.12)

        formantFilter.type = 'bandpass'
        formantFilter.frequency.setValueAtTime(formantFreq, this.ctx.currentTime)
        formantFilter.Q.setValueAtTime(3.5, this.ctx.currentTime)

        syllableGain.gain.setValueAtTime(0.4, this.ctx.currentTime)
        syllableGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.13)

        osc.connect(formantFilter)
        formantFilter.connect(syllableGain)

        // Conecta diretamente no ganho do bot, que é atualizado em tempo real quando você anda!
        syllableGain.connect(botSound.gain)

        osc.start()
        osc.stop(this.ctx.currentTime + 0.14)
      }, i * 150)
    }

    // 3. Suporte a fala em português dividida em palavras individuais que consultam o volume ao vivo
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const words = text.split(' ')
      let wordIdx = 0

      const speakNextWord = () => {
        if (wordIdx >= words.length) return
        const word = words[wordIdx++]

        const currentPos = getPlayerPos()
        const dx = botX - currentPos.x
        const dy = botY - currentPos.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        // Se o usuário andou para fora do raio durante a fala, cancela imediatamente!
        if (dist > this.maxHearingDistance) {
          window.speechSynthesis.cancel()
          return
        }

        const liveVol = Math.max(0.05, 1 - dist / this.maxHearingDistance)
        const u = new SpeechSynthesisUtterance(word)
        u.lang = 'pt-BR'
        u.volume = liveVol
        u.rate = 1.2
        u.onend = () => {
          setTimeout(speakNextWord, 20)
        }
        window.speechSynthesis.speak(u)
      }

      speakNextWord()
    }
  }

  public removeSource(sourceId: string) {
    const sound = this.soundGenerators.get(sourceId)
    if (sound) {
      sound.gain.disconnect()
      sound.panner.disconnect()
      if (sound.source) {
        sound.source.disconnect()
      }
      if (sound.extraNodes) {
        sound.extraNodes.forEach((node) => {
          try {
            node.disconnect()
          } catch (_) {}
        })
      }
      if (sound.dummyAudio) {
        sound.dummyAudio.pause()
        sound.dummyAudio.srcObject = null
      }
      this.soundGenerators.delete(sourceId)
    }
  }
}

export const proximityAudio = new ProximityAudioManager(360)
