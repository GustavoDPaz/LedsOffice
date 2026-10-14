import React, { useEffect, useState, useRef } from 'react'
import styled from 'styled-components'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import ScreenShareIcon from '@mui/icons-material/ScreenShare'
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows'
import LiveTvIcon from '@mui/icons-material/LiveTv'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import VolumeOffIcon from '@mui/icons-material/VolumeOff'
import CircularProgress from '@mui/material/CircularProgress'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import TuneIcon from '@mui/icons-material/Tune'
import HdIcon from '@mui/icons-material/Hd'
import Tooltip from '@mui/material/Tooltip'

import { useAppSelector, useAppDispatch } from '../hooks'
import { closeComputerDialog } from '../stores/ComputerStore'
import { sanitizeId } from '../util'

import Video from './Video'

const Backdrop = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 16px 180px 16px 16px;
  z-index: 100;
`

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  background: #1e2238;
  border-radius: 16px;
  padding: 16px;
  color: #eee;
  position: relative;
  display: flex;
  flex-direction: column;
  box-shadow: 0px 8px 30px rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);

  .header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    min-height: 44px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .close-btn {
    color: #94a3b8;
    &:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }
  }
`

const EscBadge = styled.div`
  font-size: 12px;
  color: #94a3b8;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 6px;
  padding: 4px 10px;

  strong {
    color: #f1f5f9;
    background: rgba(255, 255, 255, 0.12);
    padding: 2px 6px;
    border-radius: 4px;
    margin-right: 4px;
  }
`

const ViewerBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(14, 165, 233, 0.15);
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #38bdf8;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #ef4444;
    box-shadow: 0 0 8px #ef4444;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
  }
`

const QualityBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #34d399;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
`

const FullscreenFloatBtn = styled.button`
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(15, 23, 42, 0.8);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #f1f5f9;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
  transition: all 0.2s ease;
  opacity: 0.7;

  &:hover {
    opacity: 1;
    background: rgba(15, 23, 42, 0.95);
    border-color: rgba(255, 255, 255, 0.4);
    transform: scale(1.05);
  }
`

const StageArea = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0f111d;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.05);

  &:fullscreen {
    border-radius: 0;
    border: none;
    width: 100vw;
    height: 100vh;
  }
`

const StageVideo = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .player-tag {
    position: absolute;
    bottom: 16px;
    left: 16px;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    color: #f1f5f9;
  }
`

const LoadingState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #38bdf8;
  font-size: 15px;
  font-weight: 500;
`

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #94a3b8;
  padding: 24px;
  max-width: 520px;

  .screen-icon {
    font-size: 64px;
    color: #38bdf8;
    opacity: 0.8;
    margin-bottom: 16px;
  }

  h3 {
    font-size: 20px;
    color: #f1f5f9;
    font-weight: 600;
    margin-bottom: 8px;
  }

  p {
    font-size: 14px;
    line-height: 1.5;
    color: #94a3b8;
    margin-bottom: 16px;
  }

  .hint-esc {
    font-size: 12px;
    color: #64748b;

    strong {
      color: #cbd5e1;
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
    }
  }
`

export default function ComputerDialog() {
  const dispatch = useAppDispatch()
  const playerNameMap = useAppSelector((state) => state.user.playerNameMap)
  const mySessionId = useAppSelector((state) => state.user.sessionId)
  const shareScreenManager = useAppSelector((state) => state.computer.shareScreenManager)
  const myStream = useAppSelector((state) => state.computer.myStream)
  const peerStreams = useAppSelector((state) => state.computer.peerStreams)
  const presenterId = useAppSelector((state) => state.computer.presenterId)
  const [isStarting, setIsStarting] = useState(false)
  const [isAudioMuted, setIsAudioMuted] = useState(false)
  const [qualityMode, setQualityMode] = useState<'detail' | 'motion'>(
    shareScreenManager?.getQualityMode() || 'detail'
  )
  const [isFullscreen, setIsFullscreen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  // Sincroniza estado de fullscreen nativo
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Sair da tela de transmissão ao pressionar ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (document.fullscreenElement) {
          // Se estiver em fullscreen, o próprio navegador já desativa o fullscreen
          return
        }
        e.preventDefault()
        dispatch(closeComputerDialog())
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dispatch])

  const mySanitizedId = mySessionId ? sanitizeId(mySessionId) : null
  const isSharingMyScreen = Boolean(myStream)
  const peerEntries = [...peerStreams.entries()]

  // Outra pessoa está transmitindo se houver streams remotos ou se presenterId for de outro jogador
  const hasRemotePresenter = Boolean(
    peerEntries.length > 0 ||
      (presenterId && presenterId !== mySanitizedId)
  )

  // Encontra o nome do apresentador
  let presenterName = 'Apresentador'
  if (peerEntries.length > 0) {
    const [id] = peerEntries[0]
    presenterName = playerNameMap.get(id) || playerNameMap.get(sanitizeId(id)) || 'Colega'
  } else if (presenterId) {
    presenterName =
      playerNameMap.get(presenterId) || playerNameMap.get(sanitizeId(presenterId)) || 'Colega'
  }

  const handleStartShare = async () => {
    if (hasRemotePresenter || isSharingMyScreen || isStarting) return
    setIsStarting(true)
    try {
      await shareScreenManager?.startScreenShare()
      if (shareScreenManager) {
        setQualityMode(shareScreenManager.getQualityMode())
      }
    } finally {
      setIsStarting(false)
    }
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      stageRef.current?.requestFullscreen().catch((err) => {
        console.warn('[ComputerDialog] Erro ao entrar em tela cheia:', err)
      })
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  const handleToggleQualityMode = () => {
    const nextMode = qualityMode === 'detail' ? 'motion' : 'detail'
    shareScreenManager?.setQualityMode(nextMode)
    setQualityMode(nextMode)
  }

  const hasActiveVideo = isSharingMyScreen || (hasRemotePresenter && peerEntries.length > 0)

  return (
    <Backdrop>
      <Wrapper>
        <div className="header-bar">
          <div className="header-left">
            {/* Se eu estou transmitindo: botão para parar transmissão + opções de qualidade */}
            {isSharingMyScreen && (
              <>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<StopScreenShareIcon />}
                  onClick={() => shareScreenManager?.stopScreenShare()}
                  style={{
                    fontWeight: 700,
                    borderRadius: '8px',
                    padding: '6px 16px',
                  }}
                >
                  Parar Transmissão
                </Button>

                <Tooltip
                  title={
                    qualityMode === 'detail'
                      ? 'Modo Nitidez Ativo: resolução nativa preservada para textos e código cristalinos. Clique para priorizar fluidez de vídeo.'
                      : 'Modo Fluido Ativo: prioriza taxa de quadros (60fps) para vídeos/jogos. Clique para priorizar nitidez de texto.'
                  }
                >
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<TuneIcon />}
                    onClick={handleToggleQualityMode}
                    style={{
                      color: qualityMode === 'detail' ? '#38bdf8' : '#c084fc',
                      borderColor:
                        qualityMode === 'detail'
                          ? 'rgba(56, 189, 248, 0.4)'
                          : 'rgba(192, 132, 252, 0.4)',
                      backgroundColor:
                        qualityMode === 'detail'
                          ? 'rgba(56, 189, 248, 0.1)'
                          : 'rgba(192, 132, 252, 0.1)',
                      fontSize: '12px',
                      textTransform: 'none',
                      fontWeight: 600,
                      borderRadius: '8px',
                      padding: '5px 12px',
                    }}
                  >
                    {qualityMode === 'detail'
                      ? 'Modo: Nitidez (Texto/Código)'
                      : 'Modo: Fluido (Vídeo/Jogos)'}
                  </Button>
                </Tooltip>

                <QualityBadge>
                  <HdIcon fontSize="small" style={{ color: '#10b981' }} />
                  <span>HD 60fps • 8 Mbps</span>
                </QualityBadge>
              </>
            )}

            {/* Se outra pessoa está transmitindo: modo espectador garantido */}
            {hasRemotePresenter && !isSharingMyScreen && (
              <>
                <ViewerBadge>
                  <div className="live-dot" />
                  <LiveTvIcon fontSize="small" />
                  <span>
                    Assistindo transmissão de <strong>{presenterName}</strong>
                  </span>
                </ViewerBadge>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={isAudioMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
                  onClick={() => setIsAudioMuted(!isAudioMuted)}
                  style={{
                    color: isAudioMuted ? '#f87171' : '#38bdf8',
                    borderColor: isAudioMuted ? 'rgba(248, 113, 113, 0.4)' : 'rgba(56, 189, 248, 0.4)',
                    fontSize: '12px',
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                    padding: '4px 10px',
                  }}
                >
                  {isAudioMuted ? 'Áudio Mutado' : 'Áudio Ativo'}
                </Button>
                <QualityBadge>
                  <HdIcon fontSize="small" style={{ color: '#10b981' }} />
                  <span>HD Alta Qualidade</span>
                </QualityBadge>
              </>
            )}

            {/* Se ninguém está transmitindo: botão para iniciar transmissão */}
            {!hasRemotePresenter && !isSharingMyScreen && (
              <Button
                variant="contained"
                startIcon={<ScreenShareIcon />}
                onClick={handleStartShare}
                disabled={isStarting}
                style={{
                  backgroundColor: '#10b981',
                  color: '#ffffff',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  borderRadius: '8px',
                  padding: '6px 16px',
                }}
              >
                {isStarting ? 'Iniciando...' : 'Share Screen'}
              </Button>
            )}
          </div>

          <div className="header-right">
            {hasActiveVideo && (
              <Tooltip title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia (Maximizar Vídeo)'}>
                <IconButton
                  size="small"
                  onClick={toggleFullscreen}
                  style={{
                    color: '#cbd5e1',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    padding: '6px',
                  }}
                >
                  {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                </IconButton>
              </Tooltip>
            )}

            <EscBadge>
              <strong>ESC</strong> sair
            </EscBadge>
            <IconButton
              aria-label="close dialog"
              className="close-btn"
              onClick={() => dispatch(closeComputerDialog())}
              size="small"
            >
              <CloseIcon />
            </IconButton>
          </div>
        </div>

        <StageArea ref={stageRef}>
          {/* Botão flutuante de tela cheia acessível diretamente no vídeo ou em modo fullscreen */}
          {hasActiveVideo && (
            <FullscreenFloatBtn
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
            >
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </FullscreenFloatBtn>
          )}

          {/* Se eu estiver transmitindo, mostra minha tela (com áudio mutado localmente para evitar eco) */}
          {isSharingMyScreen && myStream && (
            <StageVideo>
              <Video srcObject={myStream} autoPlay muted />
              <div className="player-tag">Sua Transmissão (HD)</div>
            </StageVideo>
          )}

          {/* Se outra pessoa estiver transmitindo e a transmissão já carregou */}
          {!isSharingMyScreen && hasRemotePresenter && peerEntries.length > 0 && (
            <StageVideo>
              <Video srcObject={peerEntries[0][1].stream} autoPlay muted={isAudioMuted} />
              <div className="player-tag">{presenterName} (HD)</div>
            </StageVideo>
          )}

          {/* Se outra pessoa estiver transmitindo e o stream ainda estiver conectando via PeerJS */}
          {!isSharingMyScreen && hasRemotePresenter && peerEntries.length === 0 && (
            <LoadingState>
              <CircularProgress size={36} style={{ color: '#38bdf8' }} />
              <span>Conectando à transmissão de {presenterName}...</span>
            </LoadingState>
          )}

          {/* Se ninguém estiver transmitindo, mostra o estado vazio */}
          {!isSharingMyScreen && !hasRemotePresenter && (
            <EmptyState>
              <DesktopWindowsIcon className="screen-icon" />
              <h3>Nenhuma tela sendo transmitida no momento</h3>
              <p>
                Clique em <strong>SHARE SCREEN</strong> acima para transmitir sua tela
                em alta definição para quem estiver usando este computador.
              </p>
              <span className="hint-esc">
                Pressione <strong>ESC</strong> para sair
              </span>
            </EmptyState>
          )}
        </StageArea>
      </Wrapper>
    </Backdrop>
  )
}
