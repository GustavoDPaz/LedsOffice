import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import HeadsetIcon from '@mui/icons-material/Headset'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { useAppSelector } from '../hooks'

const ToolbarContainer = styled.div`
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(30, 34, 53, 0.88);
  backdrop-filter: blur(8px);
  padding: 6px 12px;
  border-radius: 28px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.12);
  transition: all 0.2s ease;

  &:hover {
    background: rgba(30, 34, 53, 0.95);
    border-color: rgba(66, 234, 203, 0.4);
  }
`

const ActionButton = styled(IconButton)<{ active?: boolean; danger?: boolean }>`
  color: ${(props) => (props.danger ? '#ff5252' : props.active ? '#42eacb' : '#b0b8c4')};
  background: ${(props) =>
    props.danger
      ? 'rgba(255, 82, 82, 0.15)'
      : props.active
      ? 'rgba(66, 234, 203, 0.15)'
      : 'rgba(255, 255, 255, 0.05)'};
  border: 1px solid
    ${(props) =>
      props.danger
        ? 'rgba(255, 82, 82, 0.3)'
        : props.active
        ? 'rgba(66, 234, 203, 0.3)'
        : 'transparent'};
  padding: 8px;
  transition: all 0.2s ease;

  &:hover {
    color: ${(props) => (props.danger ? '#ff7979' : '#fff')};
    background: ${(props) =>
      props.danger ? 'rgba(255, 82, 82, 0.25)' : 'rgba(66, 234, 203, 0.25)'};
    transform: scale(1.05);
  }
`

const HotkeyBadge = styled.span`
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: rgba(0, 0, 0, 0.35);
  padding: 2px 5px;
  border-radius: 4px;
  margin-left: 2px;
  border: 1px solid rgba(255, 255, 255, 0.15);
`

const ToastBanner = styled.div<{ visible: boolean; danger?: boolean }>`
  position: fixed;
  top: 68px;
  right: 16px;
  z-index: 1200;
  background: ${(props) => (props.danger ? '#d32f2f' : '#2e7d32')};
  color: #fff;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  opacity: ${(props) => (props.visible ? 1 : 0)};
  transform: ${(props) => (props.visible ? 'translateY(0)' : 'translateY(-10px)')};
  transition: all 0.25s ease;
  pointer-events: none;
`

export default function MediaToolbar() {
  const videoConnected = useAppSelector((state) => state.user.videoConnected)
  const micMuted = useAppSelector((state) => state.user.micMuted)
  const videoMuted = useAppSelector((state) => state.user.videoMuted)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastDanger, setToastDanger] = useState(false)

  const showToast = (message: string, danger = false) => {
    setToastMessage(message)
    setToastDanger(danger)
    setTimeout(() => {
      setToastMessage(null)
    }, 2000)
  }

  const handleToggleMic = () => {
    const game = phaserGame.scene.keys.game as Game | undefined
    if (!game?.network?.webRTC) return

    if (!videoConnected) {
      game.network.webRTC.getUserMedia(true)
      return
    }

    const isMuted = game.network.webRTC.toggleMute()
    showToast(isMuted ? 'Microfone mutado' : 'Microfone ativado', isMuted)
  }

  const handleToggleVideo = () => {
    const game = phaserGame.scene.keys.game as Game | undefined
    if (!game?.network?.webRTC) return

    if (!videoConnected) {
      game.network.webRTC.getUserMedia(true)
      return
    }

    const isMuted = game.network.webRTC.toggleVideo()
    showToast(isMuted ? 'Câmera desligada' : 'Câmera ligada', isMuted)
  }

  // Atalho da tecla 'M' para mutar/desmutar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'm' && !e.repeat) {
        const target = e.target as HTMLElement
        // Ignora se o usuário estiver digitando em campos de texto
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return
        }

        handleToggleMic()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [videoConnected, micMuted])

  return (
    <>
      <ToolbarContainer>
        {/* Indicador de Áudio Espacial e Proximidade */}
        <Tooltip
          title="Áudio Espacial Ativo: O volume e profundidade sonora variam com a proximidade dos avatares no mapa. Use fones de ouvido para melhor imersão estéreo!"
          arrow
        >
          <Chip
            icon={<HeadsetIcon style={{ fontSize: 16, color: '#42eacb' }} />}
            label="Espacial 3D"
            size="small"
            style={{
              background: 'rgba(66, 234, 203, 0.1)',
              color: '#42eacb',
              fontSize: 12,
              height: 26,
              border: '1px solid rgba(66, 234, 203, 0.25)',
            }}
          />
        </Tooltip>

        {/* Botão de Microfone */}
        <Tooltip
          title={
            !videoConnected
              ? 'Conectar Microfone / Áudio (M)'
              : micMuted
              ? 'Desmutar Microfone (M)'
              : 'Mutar Microfone (M)'
          }
          arrow
        >
          <ActionButton
            onClick={handleToggleMic}
            danger={videoConnected && micMuted}
            active={videoConnected && !micMuted}
            size="small"
            aria-label="Microfone"
          >
            {videoConnected && micMuted ? <MicOffIcon /> : <MicIcon />}
            <HotkeyBadge>M</HotkeyBadge>
          </ActionButton>
        </Tooltip>

        {/* Botão de Câmera */}
        <Tooltip
          title={
            !videoConnected
              ? 'Ligar Câmera'
              : videoMuted
              ? 'Ligar Câmera'
              : 'Desligar Câmera'
          }
          arrow
        >
          <ActionButton
            onClick={handleToggleVideo}
            danger={videoConnected && videoMuted}
            active={videoConnected && !videoMuted}
            size="small"
            aria-label="Câmera"
          >
            {videoConnected && videoMuted ? <VideocamOffIcon /> : <VideocamIcon />}
          </ActionButton>
        </Tooltip>
      </ToolbarContainer>

      {/* Toast notification feedback */}
      <ToastBanner visible={Boolean(toastMessage)} danger={toastDanger}>
        {toastMessage}
      </ToastBanner>
    </>
  )
}
