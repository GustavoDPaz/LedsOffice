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
      // Trigger play on loaded metadata or immediately
      const handleLoadedMetadata = () => {
        video.play().catch((err) => {
          console.warn('Video playback was prevented:', err)
        })
      }
      video.addEventListener('loadedmetadata', handleLoadedMetadata)
      video.play().catch(() => {})

      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      }
    } else {
      video.srcObject = null
    }
  }, [srcObject])

  return <video ref={refVideo} playsInline autoPlay {...props} />
}
