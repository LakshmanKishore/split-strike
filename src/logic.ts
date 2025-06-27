import type { PlayerId, RuneClient } from "rune-sdk"

export interface Piece {
  id: number
  x: number
  y: number
  velocityX: number
  velocityY: number
  ownerId: PlayerId | null
  isVisible: { [playerId: string]: boolean }
}

export interface PlayerState {
  paddleX: number
  score: number
  ready: boolean
  inactive: boolean
}

export interface GameState {
  pieces: Piece[]
  players: { [playerId: string]: PlayerState }
  gamePhase: "WAITING" | "CLAIMING" | "PLAYING" | "GAME_OVER"
  playerIds: PlayerId[]
  winnerPlayerId: PlayerId | null
  botLastActionTimestamp: number
  botAction: { name: string; data: any } | null
}

type GameActions = {
  setReady: () => void
  claimPiece: (data: { pieceId: number; x: number; y: number }) => void
  movePaddle: (x: number) => void
  flick: (data: { pieceId: number; velocityX: number; velocityY: number }) => void
  clearBotAction: () => void
}

declare global {
  const Rune: RuneClient<GameState, GameActions>
}

// Constants
const BOARD_WIDTH = 100
const BOARD_HEIGHT = 200
const CENTER_LINE = BOARD_HEIGHT / 2
const PIECE_RADIUS = 5
const PADDLE_WIDTH = 30
const PADDLE_HEIGHT = 5
const PLAYER1_PADDLE_Y = 15
const PLAYER2_PADDLE_Y = BOARD_HEIGHT - 15
const SCORE_ZONE_HEIGHT = 10
const INITIAL_PIECES_COUNT = 5
const FRICTION = 0.98
const BOUNCE_DAMPING = 0.8
const BOT_ID = "bot"
const BOT_ACTION_COOLDOWN = 1000 // 1 second

function createInitialPieces(count: number, playerIds: PlayerId[]): Piece[] {
  const pieces: Piece[] = []
  const spacing = BOARD_WIDTH / (count + 1)

  for (let i = 0; i < count; i++) {
    const isVisible: { [playerId: string]: boolean } = {}
    for (const playerId of playerIds) {
      isVisible[playerId] = true
    }

    pieces.push({
      id: i,
      x: spacing * (i + 1),
      y: CENTER_LINE,
      velocityX: 0,
      velocityY: 0,
      ownerId: null,
      isVisible,
    })
  }
  return pieces
}

function updateBot(game: GameState) {
  const botPlayerId = game.playerIds.find(id => id === BOT_ID)
  if (!botPlayerId || game.botAction) return

  const now = Rune.gameTime()
  if (now - game.botLastActionTimestamp < BOT_ACTION_COOLDOWN) return

  if (game.gamePhase === "CLAIMING") {
    const unclaimedPiece = game.pieces.find(p => p.ownerId === null)
    if (unclaimedPiece) {
      const targetY = CENTER_LINE + PIECE_RADIUS * 2
      game.botAction = {
        name: "claimPiece",
        data: { pieceId: unclaimedPiece.id, x: unclaimedPiece.x, y: targetY },
      }
      game.botLastActionTimestamp = now
    }
  } else if (game.gamePhase === "PLAYING") {
    const opponentPlayerId = game.playerIds.find(id => id !== BOT_ID)
    if (opponentPlayerId) {
      const incomingPiece = game.pieces.find(
        p => p.ownerId === opponentPlayerId && p.velocityY > 0 && p.y > CENTER_LINE
      )

      if (incomingPiece) {
        game.botAction = { name: "movePaddle", data: incomingPiece.x }
      } else {
        game.botAction = { name: "movePaddle", data: BOARD_WIDTH / 2 }
      }
    }

    const botPieceToFlick = game.pieces.find(
      p =>
        p.ownerId === botPlayerId &&
        Math.abs(p.velocityX) < 1 &&
        Math.abs(p.velocityY) < 1
    )

    if (botPieceToFlick) {
      const velocityX = (Math.random() - 0.5) * 10
      const velocityY = -10 - Math.random() * 5
      game.botAction = {
        name: "flick",
        data: { pieceId: botPieceToFlick.id, velocityX, velocityY },
      }
      game.botLastActionTimestamp = now
    }
  }
}

function updateGame(game: GameState) {
  if (game.gamePhase === "PLAYING") {
    let allPiecesScored = true

    for (const piece of game.pieces) {
      if (piece.y < -PIECE_RADIUS || piece.y > BOARD_HEIGHT + PIECE_RADIUS) {
        continue
      }

      allPiecesScored = false

      piece.velocityX *= FRICTION
      piece.velocityY *= FRICTION

      if (Math.abs(piece.velocityX) < 0.1) piece.velocityX = 0
      if (Math.abs(piece.velocityY) < 0.1) piece.velocityY = 0

      piece.x += piece.velocityX
      piece.y += piece.velocityY

      if (piece.x < PIECE_RADIUS) {
        piece.x = PIECE_RADIUS
        piece.velocityX = -piece.velocityX * BOUNCE_DAMPING
      } else if (piece.x > BOARD_WIDTH - PIECE_RADIUS) {
        piece.x = BOARD_WIDTH - PIECE_RADIUS
        piece.velocityX = -piece.velocityX * BOUNCE_DAMPING
      }

      const player1Id = game.playerIds[0]
      const player2Id = game.playerIds[1]

      if (piece.y < SCORE_ZONE_HEIGHT && piece.ownerId === player2Id) {
        game.players[player1Id].score++
        piece.y = -PIECE_RADIUS * 2
      } else if (
        piece.y > BOARD_HEIGHT - SCORE_ZONE_HEIGHT &&
        piece.ownerId === player1Id
      ) {
        game.players[player2Id].score++
        piece.y = BOARD_HEIGHT + PIECE_RADIUS * 2
      }

      for (let i = 0; i < game.playerIds.length; i++) {
        const playerId = game.playerIds[i]
        const player = game.players[playerId]
        const paddleY = i === 0 ? PLAYER1_PADDLE_Y : PLAYER2_PADDLE_Y

        if (
          piece.ownerId !== playerId &&
          Math.abs(piece.y - paddleY) < PIECE_RADIUS + PADDLE_HEIGHT / 2 &&
          piece.x > player.paddleX - PADDLE_WIDTH / 2 &&
          piece.x < player.paddleX + PADDLE_WIDTH / 2
        ) {
          piece.velocityY = -piece.velocityY * BOUNCE_DAMPING
          const hitPosition = (piece.x - player.paddleX) / (PADDLE_WIDTH / 2)
          piece.velocityX += hitPosition * 2
        }
      }

      if (piece.ownerId) {
        const ownerIndex = game.playerIds.indexOf(piece.ownerId)
        const opponentIndex = 1 - ownerIndex
        const opponentId = game.playerIds[opponentIndex]

        piece.isVisible[piece.ownerId] =
          ownerIndex === 0 ? piece.y <= CENTER_LINE : piece.y >= CENTER_LINE

        if (opponentId) {
          piece.isVisible[opponentId] =
            opponentIndex === 0 ? piece.y < CENTER_LINE : piece.y > CENTER_LINE
        }
      } else {
        for (const playerId of game.playerIds) {
          piece.isVisible[playerId] = true
        }
      }
    }

    if (allPiecesScored && game.pieces.length > 0) {
      game.gamePhase = "GAME_OVER"
      const p1Score = game.players[game.playerIds[0]].score
      const p2Score = game.players[game.playerIds[1]].score

      if (p1Score > p2Score) game.winnerPlayerId = game.playerIds[0]
      else if (p2Score > p1Score) game.winnerPlayerId = game.playerIds[1]
      else game.winnerPlayerId = null

      Rune.gameOver({
        players: {
          [game.playerIds[0]]:
            p1Score > p2Score ? "WON" : p1Score < p2Score ? "LOST" : "DRAW",
          [game.playerIds[1]]:
            p2Score > p1Score ? "WON" : p2Score < p1Score ? "LOST" : "DRAW",
        },
      })
    }
  }

  updateBot(game)
}

Rune.initLogic({
  minPlayers: 1,
  maxPlayers: 2,
  setup: allPlayerIds => {
    const players: { [playerId: string]: PlayerState } = {}
    const playerIds = [...allPlayerIds]

    if (playerIds.length === 1) {
      playerIds.push(BOT_ID)
    }

    for (const playerId of playerIds) {
      players[playerId] = {
        paddleX: BOARD_WIDTH / 2,
        score: 0,
        ready: playerId === BOT_ID, // Bot is always ready
        inactive: false,
      }
    }

    return {
      pieces: createInitialPieces(INITIAL_PIECES_COUNT, playerIds),
      players,
      gamePhase: "WAITING",
      playerIds,
      winnerPlayerId: null,
      botLastActionTimestamp: 0,
      botAction: null,
    }
  },
  update: ({ game }) => {
    updateGame(game)
  },
  actions: {
    setReady: (_, { game, playerId }) => {
      if (game.gamePhase !== "WAITING") throw Rune.invalidAction()
      game.players[playerId].ready = true

      if (Object.values(game.players).every(p => p.ready)) {
        game.gamePhase = "CLAIMING"
      }
    },
    claimPiece: ({ pieceId, x, y }, { game, playerId }) => {
      if (game.gamePhase !== "CLAIMING") throw Rune.invalidAction()

      const piece = game.pieces.find(p => p.id === pieceId)
      if (!piece || piece.ownerId) throw Rune.invalidAction()

      const playerIndex = game.playerIds.indexOf(playerId)

      if (playerIndex === 0 && y >= CENTER_LINE) throw Rune.invalidAction()
      if (playerIndex === 1 && y <= CENTER_LINE) throw Rune.invalidAction()

      piece.ownerId = playerId
      piece.x = x
      piece.y = y

      for (const pId of game.playerIds) {
        piece.isVisible[pId] = pId === playerId
      }

      if (game.pieces.every(p => p.ownerId)) {
        game.gamePhase = "PLAYING"
      }
    },
    movePaddle: (x, { game, playerId }) => {
      const player = game.players[playerId]
      if (!player) return

      player.paddleX = Math.max(
        PADDLE_WIDTH / 2,
        Math.min(BOARD_WIDTH - PADDLE_WIDTH / 2, x)
      )
    },
    flick: ({ pieceId, velocityX, velocityY }, { game, playerId }) => {
      if (game.gamePhase !== "PLAYING") throw Rune.invalidAction()

      const piece = game.pieces.find(p => p.id === pieceId)
      if (!piece || piece.ownerId !== playerId) throw Rune.invalidAction()

      const maxVelocity = 15
      piece.velocityX = Math.max(-maxVelocity, Math.min(maxVelocity, velocityX))
      piece.velocityY = Math.max(-maxVelocity, Math.min(maxVelocity, velocityY))
    },
    clearBotAction: (_, { game }) => {
      game.botAction = null
    },
  },
  playerJoined: (playerId, { game }) => {
    if (game.players[playerId]) {
      game.players[playerId].inactive = false
    }
  },
  playerLeft: (playerId, { game }) => {
    if (game.players[playerId]) {
      game.players[playerId].inactive = true
    }

    const activePlayers = Object.values(game.players).filter(p => !p.inactive)

    if (activePlayers.length <= 1) {
      if (game.gamePhase !== "GAME_OVER") {
        game.gamePhase = "GAME_OVER"
        const winner = activePlayers[0]
        if (winner) {
          game.winnerPlayerId =
            game.playerIds.find(id => game.players[id] === winner) || null
        }

        const player1Id = game.playerIds[0]
        const player2Id = game.playerIds[1]

        Rune.gameOver({
          players: {
            [player1Id]: game.winnerPlayerId === player1Id ? "WON" : "LOST",
            [player2Id]: game.winnerPlayerId === player2Id ? "WON" : "LOST",
          },
        })
      }
    }
  },
})
