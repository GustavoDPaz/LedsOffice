import React from 'react'
import styled from 'styled-components'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import ScreenShareIcon from '@mui/icons-material/ScreenShare'
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import TvIcon from '@mui/icons-material/Tv'

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
`
const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  background: #222639;
  border-radius: 16px;
  padding: 16px;
  color: #eee;
  position: relative;
  display: flex;
  flex-direction: column;
  box-shadow: 0px 0px 5px #0000006f;

  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 100;
    color: #eee;
    background: rgba(0, 0, 0, 0.4);
    &:hover {
      background: rgba(0, 0, 0, 0.8);
      color: #ff5252;
    }
  }

  .toolbar {
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
`

const VideoGrid = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(40%, 1fr));
  position: relative;

  .video-container {
    position: relative;
    background: black;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);

    video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      object-fit: contain;
    }

    .player-name {
      position: absolute;
      bottom: 16px;
      left: 16px;
      color: #fff;
      background: rgba(0, 0, 0, 0.65);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      text-shadow: 0 1px 2px rgb(0 0 0 / 60%);
      white-space: nowrap;
      z-index: 5;
    }
  }
`

const EmptyPlaceholder = styled.div`
  grid-column: 1 / -1;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #9aa3b2;
  text-align: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.15);

  h3 {
    margin: 12px 0 6px 0;
    color: #eee;
    font-size: 20px;
  }

  p {
    margin: 0;
    font-size: 15px;
    color: #8b96a8;
    max-width: 480px;
  }
`

function VideoContainer({ playerName, stream }: { playerName?: string; stream: MediaStream }) {
  return (
    <div className="video-container">
      <Video srcObject={stream} autoPlay />
      {playerName && <div className="player-name">{playerName}</div>}
    </div>
  )
}

export default function ComputerDialog() {
  const dispatch = useAppDispatch()
  const playerNameMap = useAppSelector((state) => state.user.playerNameMap)
  const shareScreenManager = useAppSelector((state) => state.computer.shareScreenManager)
  const myStream = useAppSelector((state) => state.computer.myStream)
  const peerStreams = useAppSelector((state) => state.computer.peerStreams)

  const hasAnyStreams = myStream !== null || (peerStreams && peerStreams.size > 0)

  return (
    <Backdrop>
      <Wrapper>
        <IconButton
          aria-label="close dialog"
          className="close"
          onClick={() => dispatch(closeComputerDialog())}
        >
          <CloseIcon />
        </IconButton>

        <div className="toolbar">
          <Button
            variant="contained"
            color={shareScreenManager?.myStream ? 'error' : 'secondary'}
            startIcon={
              shareScreenManager?.myStream ? <StopScreenShareIcon /> : <ScreenShareIcon />
            }
            onClick={() => {
              if (shareScreenManager?.myStream) {
                shareScreenManager?.stopScreenShare()
              } else {
                shareScreenManager?.startScreenShare()
              }
            }}
          >
            {shareScreenManager?.myStream ? 'Stop sharing' : 'Share Screen'}
          </Button>
        </div>

        <VideoGrid>
          {hasAnyStreams ? (
            <>
              {myStream && <VideoContainer stream={myStream} playerName="Sua Tela (Você)" />}

              {peerStreams &&
                [...peerStreams.entries()].map(([id, { stream }]) => {
                  const playerName = playerNameMap.get(id) || 'Colega'
                  return <VideoContainer key={id} playerName={playerName} stream={stream} />
                })}
            </>
          ) : (
            <EmptyPlaceholder>
              <TvIcon style={{ fontSize: 56, color: '#42eacb', opacity: 0.8 }} />
              <h3>Nenhuma tela sendo transmitida no momento</h3>
              <p>
                Clique em <strong>SHARE SCREEN</strong> acima para transmitir sua tela para quem estiver usando este computador.
              </p>
            </EmptyPlaceholder>
          )}
        </VideoGrid>
      </Wrapper>
    </Backdrop>
  )
}
