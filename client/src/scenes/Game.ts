import Phaser from 'phaser'

// import { debugDraw } from '../utils/debug'
import { createCharacterAnims } from '../anims/CharacterAnims'

import Item from '../items/Item'
import Chair from '../items/Chair'
import Computer from '../items/Computer'
import Whiteboard from '../items/Whiteboard'
import VendingMachine from '../items/VendingMachine'
import '../characters/MyPlayer'
import '../characters/OtherPlayer'
import MyPlayer from '../characters/MyPlayer'
import OtherPlayer from '../characters/OtherPlayer'
import PlayerSelector from '../characters/PlayerSelector'
import Network from '../services/Network'
import { IPlayer } from '../../../types/IOfficeState'
import { PlayerBehavior } from '../../../types/PlayerBehavior'
import { ItemType } from '../../../types/Items'

import store from '../stores'
import { setFocused, setShowChat } from '../stores/ChatStore'
import { NavKeys, Keyboard } from '../../../types/KeyboardState'

export default class Game extends Phaser.Scene {
  network!: Network
  private cursors!: NavKeys
  private keyE!: Phaser.Input.Keyboard.Key
  private keyR!: Phaser.Input.Keyboard.Key
  private keyM!: Phaser.Input.Keyboard.Key
  private map!: Phaser.Tilemaps.Tilemap
  myPlayer!: MyPlayer
  private playerSelector!: Phaser.GameObjects.Zone
  private otherPlayers!: Phaser.Physics.Arcade.Group
  private otherPlayerMap = new Map<string, OtherPlayer>()
  computerMap = new Map<string, Computer>()
  private whiteboardMap = new Map<string, Whiteboard>()

  constructor() {
    super('game')
  }

  registerKeys() {
    this.cursors = {
      ...this.input.keyboard.createCursorKeys(),
      ...(this.input.keyboard.addKeys('W,S,A,D') as Keyboard),
    }

    // maybe we can have a dedicated method for adding keys if more keys are needed in the future
    this.keyE = this.input.keyboard.addKey('E')
    this.keyR = this.input.keyboard.addKey('R')
    this.keyM = this.input.keyboard.addKey('M')
    this.keyM.on('down', () => {
      this.network.webRTC?.toggleMute()
    })
    this.input.keyboard.disableGlobalCapture()
    this.input.keyboard.on('keydown-ENTER', (event) => {
      store.dispatch(setShowChat(true))
      store.dispatch(setFocused(true))
    })
    this.input.keyboard.on('keydown-ESC', (event) => {
      store.dispatch(setShowChat(false))
    })
  }

  disableKeys() {
    this.input.keyboard.enabled = false
  }

  enableKeys() {
    this.input.keyboard.enabled = true
  }

  create(data: { network: Network }) {
    if (!data.network) {
      throw new Error('server instance missing')
    } else {
      this.network = data.network
    }

    createCharacterAnims(this.anims)

    this.map = this.make.tilemap({ key: 'tilemap' })
    const FloorAndGround = this.map.addTilesetImage('FloorAndGround', 'tiles_wall')
    const ModernOffice = this.map.addTilesetImage('Modern_Office_Black_Shadow', 'office')
    const Interiors = this.map.addTilesetImage('Interiors_free_32x32', 'interiors')
    const tilesetList = [FloorAndGround, ModernOffice, Interiors].filter(Boolean) as Phaser.Tilemaps.Tileset[]

    const groundLayer =
      this.map.createLayer('Ground', FloorAndGround) ||
      this.map.createLayer('Floor', FloorAndGround)
    if (groundLayer) {
      groundLayer.setDepth(0)
      groundLayer.setCollisionByProperty({ collides: true })
    }

    const collidableTileLayers: Phaser.Tilemaps.TilemapLayer[] = []
    const createdLayers = new Set<string>()
    if (groundLayer) {
      createdLayers.add('Ground')
      createdLayers.add('Floor')
    }

    this.map.layers.forEach((layerData) => {
      const layerName = layerData.name
      if (createdLayers.has(layerName)) return
      createdLayers.add(layerName)

      const l = this.map.createLayer(layerName, tilesetList)
      if (l) {
        const lower = layerName.toLowerCase()
        const isWall = lower.includes('wall') && !lower.includes('nocollid') && !lower.includes('wall_no')
        const isObjectsCollide =
          lower === 'objects_collide' ||
          lower === 'objetcs_collide' ||
          lower.includes('object') ||
          lower.includes('objetc')
        const isFurniture = lower.includes('furniture') && !lower.includes('seat')

        if (isWall || isObjectsCollide || isFurniture) {
          l.setCollisionByExclusion([-1, 0])
          collidableTileLayers.push(l)
        }

        if (lower.includes('seat')) {
          l.setDepth(10)
        } else if (lower.includes('sofa')) {
          l.setDepth(15)
        } else if (isFurniture) {
          l.setDepth(20)
        } else if (lower.includes('pc')) {
          l.setDepth(30)
        } else if (isWall) {
          l.setDepth(50)
        } else if (lower.includes('quadro') || lower.includes('whiteboard')) {
          // Quadro branco acima de Wall (50) para ser visível na parede
          l.setDepth(55)
        } else if (isObjectsCollide) {
          // Objects_collide acima de Wall (50) e Furniture (20)
          l.setDepth(60)
        } else if (lower.includes('nocollid') || lower.includes('wall_no')) {
          l.setDepth(6000)
        } else {
          l.setDepth(25)
        }
      }
    })

    const spawnX = this.map.width > 50 ? 1360 : 705
    const spawnY = this.map.width > 50 ? 272 : 500
    this.myPlayer = this.add.myPlayer(spawnX, spawnY, 'adam', this.network.mySessionId)
    this.playerSelector = new PlayerSelector(this, 0, 0, 16, 16)

    // import chair objects from Tiled map to Phaser
    const chairs = this.physics.add.staticGroup({ classType: Chair })
    const chairLayer = this.map.getObjectLayer('Chair')
    if (chairLayer && chairLayer.objects.length > 0) {
      chairLayer.objects.forEach((chairObj) => {
        const item = this.addObjectFromTiled(chairs, chairObj, 'chairs', 'chair') as Chair
        if (item) {
          item.setAlpha(0)
          if (chairObj.properties && chairObj.properties[0]) {
            item.itemDirection = chairObj.properties[0].value
          }
        }
      })
    }

    // Auto-detect chairs from Furniture_seat tile layer if no objects imported
    if (chairs.getLength() === 0 && this.map.getLayer('Furniture_seat')) {
      for (let y = 0; y < this.map.height; y++) {
        for (let x = 0; x < this.map.width; x++) {
          const tile = this.map.getTileAt(x, y, true, 'Furniture_seat')
          if (tile && tile.index > 0) {
            let dir: string | undefined
            if (tile.index === 2708) dir = 'down'
            else if (tile.index === 2705) dir = 'up'
            else if (tile.index === 2710) dir = 'right'
            else if (tile.index === 2709) dir = 'left'

            if (dir) {
              const actualX = x * 32 + 16
              const actualY = y * 32
              const item = chairs.get(actualX, actualY, 'chairs', 0) as Chair
              if (item) {
                item.setAlpha(0)
                item.setDepth(actualY)
                item.itemDirection = dir
              }
            }
          }
        }
      }
    }

    // import computers objects from Tiled map to Phaser
    const computers = this.physics.add.staticGroup({ classType: Computer })
    const computerLayer = this.map.getObjectLayer('Computer')
    if (computerLayer) {
      computerLayer.objects.forEach((obj, i) => {
        const item = this.addObjectFromTiled(computers, obj, 'computers', 'computer') as Computer
        if (item) {
          item.setAlpha(0)
          item.setDepth(-100)
          const id = `${i}`
          item.id = id
          this.computerMap.set(id, item)
        }
      })
    }

    // import whiteboards objects from Tiled map to Phaser
    const whiteboards = this.physics.add.staticGroup({ classType: Whiteboard })
    const whiteboardLayer = this.map.getObjectLayer('Whiteboard')
    if (whiteboardLayer) {
      whiteboardLayer.objects.forEach((obj, i) => {
        const item = this.addObjectFromTiled(
          whiteboards,
          obj,
          'whiteboards',
          'whiteboard'
        ) as Whiteboard
        if (item) {
          item.setAlpha(0)
          item.setDepth(-100)
          const id = `${i}`
          item.id = id
          this.whiteboardMap.set(id, item)
        }
      })
    }

    // import vending machine objects from Tiled map to Phaser
    const vendingMachines = this.physics.add.staticGroup({ classType: VendingMachine })
    const vendingMachineLayer = this.map.getObjectLayer('VendingMachine')
    if (vendingMachineLayer) {
      vendingMachineLayer.objects.forEach((obj, i) => {
        this.addObjectFromTiled(vendingMachines, obj, 'vendingmachines', 'vendingmachine')
      })
    }

    // import other objects from Tiled map to Phaser
    this.addGroupFromTiled('Wall', 'tiles_wall', 'FloorAndGround', false)
    this.addGroupFromTiled('Objects', 'office', 'Modern_Office_Black_Shadow', false)
    this.addGroupFromTiled('ObjectsOnCollide', 'office', 'Modern_Office_Black_Shadow', true)
    this.addGroupFromTiled('GenericObjects', 'generic', 'Generic', false)
    this.addGroupFromTiled('GenericObjectsOnCollide', 'generic', 'Generic', true)
    this.addGroupFromTiled('Basement', 'basement', 'Basement', true)

    this.otherPlayers = this.physics.add.group({ classType: OtherPlayer })

    this.cameras.main.zoom = 1.5
    this.cameras.main.startFollow(this.myPlayer, true)

    if (groundLayer) {
      this.physics.add.collider([this.myPlayer, this.myPlayer.playerContainer], groundLayer)
    }
    collidableTileLayers.forEach((l) => {
      this.physics.add.collider([this.myPlayer, this.myPlayer.playerContainer], l)
    })
    this.physics.add.collider([this.myPlayer, this.myPlayer.playerContainer], vendingMachines)

    this.physics.add.overlap(
      this.playerSelector,
      [chairs, computers, whiteboards, vendingMachines],
      this.handleItemSelectorOverlap,
      undefined,
      this
    )

    this.physics.add.overlap(
      this.myPlayer,
      this.otherPlayers,
      this.handlePlayersOverlap,
      undefined,
      this
    )

    // register network event listeners
    this.network.onPlayerJoined(this.handlePlayerJoined, this)
    this.network.onPlayerLeft(this.handlePlayerLeft, this)
    this.network.onMyPlayerReady(this.handleMyPlayerReady, this)
    this.network.onMyPlayerVideoConnected(this.handleMyVideoConnected, this)
    this.network.onPlayerUpdated(this.handlePlayerUpdated, this)
    this.network.onItemUserAdded(this.handleItemUserAdded, this)
    this.network.onItemUserRemoved(this.handleItemUserRemoved, this)
    this.network.onChatMessageAdded(this.handleChatMessageAdded, this)
  }

  private handleItemSelectorOverlap(playerSelector, selectionItem) {
    const currentItem = playerSelector.selectedItem as Item
    if (currentItem) {
      if (currentItem === selectionItem) return

      // Prioritize computer/whiteboard interactions while sitting or in front of desk
      if (this.myPlayer?.playerBehavior === PlayerBehavior.SITTING) {
        if (
          currentItem.itemType === ItemType.CHAIR &&
          selectionItem.itemType === ItemType.COMPUTER
        ) {
          // allow selecting computer while sitting
        } else if (currentItem.itemType === ItemType.COMPUTER) {
          return
        }
      } else {
        if (currentItem.depth >= selectionItem.depth && currentItem.itemType === selectionItem.itemType) {
          return
        }
      }

      if (this.myPlayer?.playerBehavior !== PlayerBehavior.SITTING) currentItem.clearDialogBox()
    }

    // set selected item and set up new dialog
    playerSelector.selectedItem = selectionItem
    selectionItem.onOverlapDialog()
  }

  private addObjectFromTiled(
    group: Phaser.Physics.Arcade.StaticGroup,
    object: Phaser.Types.Tilemaps.TiledObject,
    key: string,
    tilesetName: string
  ) {
    const actualX = object.x! + object.width! * 0.5
    const actualY = object.y! - object.height! * 0.5
    const tileset = this.map.getTileset(tilesetName)
    const firstgid = tileset ? tileset.firstgid : 0
    const frame = object.gid ? object.gid - firstgid : 0
    const obj = group.get(actualX, actualY, key, Math.max(0, frame))
    if (obj) {
      obj.setDepth(actualY)
    }
    return obj
  }

  private addGroupFromTiled(
    objectLayerName: string,
    key: string,
    tilesetName: string,
    collidable: boolean
  ) {
    const objectLayer = this.map.getObjectLayer(objectLayerName)
    if (!objectLayer) return
    const tileset = this.map.getTileset(tilesetName)
    if (!tileset) return

    const group = this.physics.add.staticGroup()
    objectLayer.objects.forEach((object) => {
      const actualX = object.x! + object.width! * 0.5
      const actualY = object.y! - object.height! * 0.5
      group
        .get(actualX, actualY, key, object.gid! - tileset.firstgid)
        .setDepth(actualY)
    })
    if (this.myPlayer && collidable)
      this.physics.add.collider([this.myPlayer, this.myPlayer.playerContainer], group)
  }

  // function to add new player to the otherPlayer group
  private handlePlayerJoined(newPlayer: IPlayer, id: string) {
    const otherPlayer = this.add.otherPlayer(newPlayer.x, newPlayer.y, 'adam', id, newPlayer.name)
    this.otherPlayers.add(otherPlayer)
    this.otherPlayerMap.set(id, otherPlayer)
  }

  // function to remove the player who left from the otherPlayer group
  private handlePlayerLeft(id: string) {
    if (this.otherPlayerMap.has(id)) {
      const otherPlayer = this.otherPlayerMap.get(id)
      if (!otherPlayer) return
      this.otherPlayers.remove(otherPlayer, true, true)
      this.otherPlayerMap.delete(id)
    }
  }

  private handleMyPlayerReady() {
    this.myPlayer.readyToConnect = true
  }

  private handleMyVideoConnected() {
    this.myPlayer.videoConnected = true
  }

  // function to update target position upon receiving player updates
  private handlePlayerUpdated(field: string, value: number | string, id: string) {
    const otherPlayer = this.otherPlayerMap.get(id)
    otherPlayer?.updateOtherPlayer(field, value)
  }

  private handlePlayersOverlap(myPlayer, otherPlayer) {
    otherPlayer.makeCall(myPlayer, this.network?.webRTC)
  }

  private handleItemUserAdded(playerId: string, itemId: string, itemType: ItemType) {
    if (itemType === ItemType.COMPUTER) {
      const computer = this.computerMap.get(itemId)
      computer?.addCurrentUser(playerId)
    } else if (itemType === ItemType.WHITEBOARD) {
      const whiteboard = this.whiteboardMap.get(itemId)
      whiteboard?.addCurrentUser(playerId)
    }
  }

  private handleItemUserRemoved(playerId: string, itemId: string, itemType: ItemType) {
    if (itemType === ItemType.COMPUTER) {
      const computer = this.computerMap.get(itemId)
      computer?.removeCurrentUser(playerId)
    } else if (itemType === ItemType.WHITEBOARD) {
      const whiteboard = this.whiteboardMap.get(itemId)
      whiteboard?.removeCurrentUser(playerId)
    }
  }

  private handleChatMessageAdded(playerId: string, content: string) {
    const otherPlayer = this.otherPlayerMap.get(playerId)
    otherPlayer?.updateDialogBubble(content)
  }

  update(t: number, dt: number) {
    if (this.myPlayer && this.network) {
      this.playerSelector.update(this.myPlayer, this.cursors)
      this.myPlayer.update(this.playerSelector, this.cursors, this.keyE, this.keyR, this.network)

      const webRTC = this.network.webRTC
      if (webRTC) {
        this.otherPlayerMap.forEach((otherPlayer, id) => {
          webRTC.updateSpatialAudio(
            id,
            this.myPlayer.x,
            this.myPlayer.y,
            otherPlayer.x,
            otherPlayer.y
          )
          otherPlayer.checkProximity(this.myPlayer, webRTC)
        })
      }
    }
  }
}
