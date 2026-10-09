import React, { useEffect } from 'react'
import styled from 'styled-components'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import ScreenShareIcon from '@mui/icons-material/ScreenShare'
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows'
import LiveTvIcon from '@mui/icons-material/LiveTv'

import { useAppSelector, useAppDispatch } from '../hooks'
import { closeComputerDialog } from '../stores/ComputerStore'

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
  const shareScreenManager = useAppSelector((state) => state.computer.shareScreenManager)
  const myStream = useAppSelector((state) => state.computer.myStream)
  const peerStreams = useAppSelector((state) => state.computer.peerStreams)

  // Sair da tela de transmissão ao pressionar ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault()
        dispatch(closeComputerDialog())
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dispatch])

  const isSharingMyScreen = Boolean(myStream)
  const peerEntries = [...peerStreams.entries()]
  const hasPeerSharing = peerEntries.length > 0

  // Identifica o apresentador quando alguém estiver transmitindo
  const activePeer = hasPeerSharing ? peerEntries[0] : null
  const presenterId = activePeer ? activePeer[0] : null
  const presenterName = presenterId
    ? playerNameMap.get(presenterId) || 'Colega'
    : 'Apresentador'

  return (
    <Backdrop>
      <Wrapper>
        <div className="header-bar">
          <div className="header-left">
            {/* Se eu estou transmitindo: botão para parar transmissão */}
            {isSharingMyScreen && (
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
            )}

            {/* Se outra pessoa está transmitindo: apenas assistir, NÃO pode transmitir */}
            {hasPeerSharing && !isSharingMyScreen && (
              <ViewerBadge>
                <div className="live-dot" />
                <LiveTvIcon fontSize="small" />
                <span>
                  Assistindo transmissão de <strong>{presenterName}</strong>
                </span>
              </ViewerBadge>
            )}

            {/* Se ninguém está transmitindo: botão para iniciar transmissão */}
            {!hasPeerSharing && !isSharingMyScreen && (
              <Button
                variant="contained"
                startIcon={<ScreenShareIcon />}
                onClick={() => shareScreenManager?.startScreenShare()}
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
                Share Screen
              </Button>
            )}
          </div>

          <div className="header-right">
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

        <StageArea>
          {/* Se eu estiver transmitindo, mostra minha tela */}
          {isSharingMyScreen && myStream && (
            <StageVideo>
              <Video srcObject={myStream} autoPlay />
              <div className="player-tag">Sua Transmissão</div>
            </StageVideo>
          )}

          {/* Se outra pessoa estiver transmitindo, mostra a tela dela em modo de exibição total */}
          {!isSharingMyScreen && hasPeerSharing && activePeer && (
            <StageVideo>
              <Video srcObject={activePeer[1].stream} autoPlay />
              <div className="player-tag">{presenterName}</div>
            </StageVideo>
          )}

          {/* Se ninguém estiver transmitindo, mostra o estado vazio informativo */}
          {!isSharingMyScreen && !hasPeerSharing && (
            <EmptyState>
              <DesktopWindowsIcon className="screen-icon" />
              <h3>Nenhuma tela sendo transmitida no momento</h3>
              <p>
                Clique em <strong>SHARE SCREEN</strong> acima para transmitir sua tela
                para quem estiver usando este computador.
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
