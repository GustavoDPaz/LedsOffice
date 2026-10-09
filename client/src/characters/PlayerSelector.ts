import Phaser from 'phaser'
import MyPlayer from './MyPlayer'
import { PlayerBehavior } from '../../../types/PlayerBehavior'
import Item from '../items/Item'
import Chair from '../items/Chair'
import { NavKeys } from '../../../types/KeyboardState'

export default class PlayerSelector extends Phaser.GameObjects.Zone {
  selectedItem?: Item
  selectedChair?: Chair

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
    super(scene, x, y, width, height)

    scene.physics.add.existing(this)
  }

  update(player: MyPlayer, cursors: NavKeys) {
    if (!cursors) {
      return
    }

    // no need to update player selection while sitting
    if (player.playerBehavior === PlayerBehavior.SITTING) {
      return
    }

    // Atualiza a posição da caixa de seleção em frente ao jogador, mesmo quando parado
    const { x, y } = player
    let joystickLeft = false
    let joystickRight = false
    let joystickUp = false
    let joystickDown = false
    if (player.joystickMovement?.isMoving) {
      joystickLeft = player.joystickMovement?.direction.left
      joystickRight = player.joystickMovement?.direction.right
      joystickUp = player.joystickMovement?.direction.up
      joystickDown = player.joystickMovement?.direction.down
    }

    let dir = 'down'
    if (cursors.left?.isDown || cursors.A?.isDown || joystickLeft) {
      dir = 'left'
    } else if (cursors.right?.isDown || cursors.D?.isDown || joystickRight) {
      dir = 'right'
    } else if (cursors.up?.isDown || cursors.W?.isDown || joystickUp) {
      dir = 'up'
    } else if (cursors.down?.isDown || cursors.S?.isDown || joystickDown) {
      dir = 'down'
    } else {
      // Quando parado, mantém a direção que o personagem está olhando
      const animKey = player.anims.currentAnim?.key
      if (animKey) {
        const parts = animKey.split('_')
        if (parts.length >= 3) {
          dir = parts[2]
        }
      }
    }

    const offset = 24
    if (dir === 'left') {
      this.setPosition(x - offset, y)
    } else if (dir === 'right') {
      this.setPosition(x + offset, y)
    } else if (dir === 'up') {
      this.setPosition(x, y - offset)
    } else if (dir === 'down') {
      this.setPosition(x, y + offset)
    }

    // Enquanto a cadeira estiver selecionada,
    // se o seletor deixar de sobrepor a cadeira, limpa o diálogo
    if (this.selectedChair) {
      if (!this.scene.physics.overlap(this, this.selectedChair)) {
        this.selectedChair.clearDialogBox()
        this.selectedChair = undefined
      }
    }

    // Enquanto outro item estiver selecionado,
    // se o seletor deixar de sobrepor o item, limpa a caixa de diálogo
    if (this.selectedItem) {
      if (!this.scene.physics.overlap(this, this.selectedItem)) {
        this.selectedItem.clearDialogBox()
        this.selectedItem = undefined
      }
    }
  }
}
