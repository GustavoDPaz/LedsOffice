import React, { useEffect, useState, useRef } from 'react'
import styled from 'styled-components'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import HeadsetIcon from '@mui/icons-material/Headset'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'

import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import { useAppSelector } from '../hooks'

interface Position {
  x: number
  y: number
}

const STORAGE_KEY = 'ledsoffice_mediatoolbar_pos'

const ToolbarContainer = styled.div<{ isDragging: boolean }>`
  position: fixed;
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(30, 34, 53, 0.92);
  backdrop-filter: blur(10px);
  padding: 6px 12px;
  border-radius: 28px;
  box-shadow: ${(props) =>
    props.isDragging
      ? '0 8px 25px rgba(0, 0, 0, 0.6), 0 0 10px rgba(66, 234, 203, 0.5)'
      : '0 4px 15px rgba(0, 0, 0, 0.35)'};
  border: 1px solid
    ${(props) => (props.isDragging ? 'rgba(66, 234, 203, 0.6)' : 'rgba(255, 255, 255, 0.14)')};
  cursor: ${(props) => (props.isDragging ? 'grabbing' : 'grab')};
  user-select: none;
  touch-action: none;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;

  &:hover {
    background: rgba(30, 34, 53, 0.98);
    border-color: rgba(66, 234, 203, 0.5);
  }
`

const DragHandle = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7e8ba3;
  padding: 2px;
  margin-right: -2px;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }

  &:hover {
    color: #42eacb;
  }
`

const ActionButton = styled(IconButton)<{ active?: boolean; danger?: boolean }>`
  cursor: pointer;
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

  const toolbarRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef<{ offsetX: number; offsetY: number }>({ offsetX: 0, offsetY: 0 })

  // Posição arrastável com persistência em localStorage
  const [position, setPosition] = useState<Position>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return {
            x: Math.min(Math.max(10, parsed.x), window.innerWidth - 100),
            y: Math.min(Math.max(10, parsed.y), window.innerHeight - 60),
          }
        }
      }
    } catch (e) {}

    // Posição inicial padrão: canto superior direito
    return {
      x: Math.max(10, window.innerWidth - 320),
      y: 16,
    }
  })

  // Início do arrasto
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return // Apenas botão esquerdo

    // Não arrasta se o clique foi direto num botão de ação
    const target = e.target as HTMLElement
    if (target.closest('button')) return

    setIsDragging(true)
    const rect = toolbarRef.current?.getBoundingClientRect()
    dragOffset.current = {
      offsetX: e.clientX - (rect ? rect.left : position.x),
      offsetY: e.clientY - (rect ? rect.top : position.y),
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch (err) {}
  }

  // Movimento do arrasto
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return

    const toolbarWidth = toolbarRef.current?.offsetWidth || 300
    const toolbarHeight = toolbarRef.current?.offsetHeight || 44

    const newX = Math.min(
      Math.max(10, e.clientX - dragOffset.current.offsetX),
      window.innerWidth - toolbarWidth - 10
    )
    const newY = Math.min(
      Math.max(10, e.clientY - dragOffset.current.offsetY),
      window.innerHeight - toolbarHeight - 10
    )

    setPosition({ x: newX, y: newY })
  }

  // Fim do arrasto
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch (err) {}
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
      } catch (err) {}
    }
  }

  // Ajusta se a janela for redimensionada para não sumir da tela
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        const toolbarWidth = toolbarRef.current?.offsetWidth || 300
        const toolbarHeight = toolbarRef.current?.offsetHeight || 44
        const updated = {
          x: Math.min(Math.max(10, prev.x), window.innerWidth - toolbarWidth - 10),
          y: Math.min(Math.max(10, prev.y), window.innerHeight - toolbarHeight - 10),
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        } catch (e) {}
        return updated
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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
      <ToolbarContainer
        ref={toolbarRef}
        isDragging={isDragging}
        style={{ left: `${position.x}px`, top: `${position.y}px` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Alça de Arraste */}
        <Tooltip title="Clique e arraste para mover a barra para onde preferir no monitor" arrow>
          <DragHandle>
            <DragIndicatorIcon fontSize="small" />
          </DragHandle>
        </Tooltip>

        {/* Indicador de Áudio Espacial e Proximidade */}
        <Tooltip
          title="Áudio Espacial Ativo: Volume e profundidade sonora variam com a proximidade física. Use fones de ouvido para melhor imersão estéreo!"
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
              cursor: 'inherit',
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

      {/* Toast notification feedback acompanhando a posição */}
      <ToastBanner
        visible={Boolean(toastMessage)}
        danger={toastDanger}
        style={{ left: `${position.x}px`, top: `${position.y + 48}px` }}
      >
        {toastMessage}
      </ToastBanner>
    </>
  )
}
