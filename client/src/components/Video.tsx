import React, { VideoHTMLAttributes, useEffect, useRef } from 'react'

type PropsType = VideoHTMLAttributes<HTMLVideoElement> & {
  srcObject?: MediaStream | null
}

export default function Video({ srcObject, ...props }: PropsType) {
  const refVideo = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = refVideo.current
    if (!video) return

    if (srcObject) {
      video.srcObject = srcObject
      video.playsInline = true

      const attemptPlay = () => {
        video.play().catch((err) => {
          console.warn('[Video] Playback com som bloqueado pela política de autoplay, aplicando fallback mudo:', err)
          // Se o navegador bloquear por conter áudio sem interação do usuário, mutamos para que o vídeo renderize imediatamente
          video.muted = true
          video.play().catch((e) => {
            console.warn('[Video] Falha também ao tentar reproduzir mutado:', e)
          })
        })
      }

      video.addEventListener('loadedmetadata', attemptPlay)
      attemptPlay()

      // Retoma reprodução se o vídeo estiver pausado assim que o usuário interagir com a tela
      const handleInteraction = () => {
        if (video.paused && video.srcObject) {
          video.play().catch(() => {})
        }
      }

      window.addEventListener('click', handleInteraction, { passive: true })
      window.addEventListener('keydown', handleInteraction, { passive: true })

      return () => {
        video.removeEventListener('loadedmetadata', attemptPlay)
        window.removeEventListener('click', handleInteraction)
        window.removeEventListener('keydown', handleInteraction)
      }
    } else {
      video.srcObject = null
    }
  }, [srcObject])

  return <video ref={refVideo} playsInline autoPlay {...props} />
}
