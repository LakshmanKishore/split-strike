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
}

export interface GameState {
  pieces: Piece[]
  players: { [playerId: string]: PlayerState }
  gamePhase: "WAITING" | "CLAIMING" | "PLAYING" | "GAME_OVER"
  lastMovePlayerId: PlayerId | null
  playerIds: PlayerId[]
  winnerPlayerId: PlayerId | null
}

type GameActions = {
  setReady: () => void
  claimPiece: (pieceId: number) => void
  movePaddle: (x: number) => void
  flick: (pieceId: number, velocityX: number, velocityY: number) => void
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
const PLAYER1_PADDLE_Y = CENTER_LINE - 15
const PLAYER2_PADDLE_Y = CENTER_LINE + 15
const SCORE_ZONE_HEIGHT = 10
const INITIAL_PIECES_COUNT = 5
const FRICTION = 0.98
const BOUNCE_DAMPING = 0.8

function createInitialPieces(count: number): Piece[] {
  const pieces: Piece[] = []
  const spacing = BOARD_WIDTH / (count + 1)

  for (let i = 0; i < count; i++) {
    pieces.push({
      id: i,
      x: spacing * (i + 1),
      y: CENTER_LINE,
      velocityX: 0,
      velocityY: 0,
      ownerId: null,
      isVisible: {} // Will be populated with player IDs in setup
    })
  }
  return pieces
}

function updatePiecePositions(pieces: Piece[], players: { [playerId: string]: PlayerState }, playerIds: PlayerId[]) {
  const updatedPieces = [...pieces]
  let isGameOver = true

  updatedPieces.forEach(piece => {
    // If piece is already in a scoring tray, skip it
    if (piece.y < 0 || piece.y > BOARD_HEIGHT) {
      return
    }
    
    isGameOver = false

    // Apply friction
    piece.velocityX *= FRICTION
    piece.velocityY *= FRICTION

    // Stop very slow pieces
    if (Math.abs(piece.velocityX) < 0.1) piece.velocityX = 0
    if (Math.abs(piece.velocityY) < 0.1) piece.velocityY = 0

    // Update position
    piece.x += piece.velocityX
    piece.y += piece.velocityY

    // Bounce off walls
    if (piece.x < PIECE_RADIUS) {
      piece.x = PIECE_RADIUS
      piece.velocityX = -piece.velocityX * BOUNCE_DAMPING
    }
    if (piece.x > BOARD_WIDTH - PIECE_RADIUS) {
      piece.x = BOARD_WIDTH - PIECE_RADIUS
      piece.velocityX = -piece.velocityX * BOUNCE_DAMPING
    }

    // Handle crossing the center line - update visibility
    if (piece.y < CENTER_LINE && piece.ownerId) {
      // Piece is in player 1's territory
      playerIds.forEach(id => {
        // Player 1 sees the piece if it belongs to them or if it crossed from player 2
        if (id === playerIds[0]) {
          piece.isVisible[id] = true
        } 
        // Player 2 only sees their own pieces
        else if (id === playerIds[1] && piece.ownerId === id) {
          piece.isVisible[id] = true
        } else {
          piece.isVisible[id] = false
        }
      })
    } else if (piece.y > CENTER_LINE && piece.ownerId) {
      // Piece is in player 2's territory
      playerIds.forEach(id => {
        // Player 2 sees the piece if it belongs to them or if it crossed from player 1
        if (id === playerIds[1]) {
          piece.isVisible[id] = true
        } 
        // Player 1 only sees their own pieces
        else if (id === playerIds[0] && piece.ownerId === id) {
          piece.isVisible[id] = true
        } else {
          piece.isVisible[id] = false
        }
      })
    }

    // Bounce off paddles
    playerIds.forEach((playerId, index) => {
      const playerState = players[playerId]
      const paddleY = index === 0 ? PLAYER1_PADDLE_Y : PLAYER2_PADDLE_Y
      
      // If the piece is at the paddle's y position and within its width
      if (
        (piece.ownerId !== playerId) && // Players can't block their own pieces
        ((index === 0 && piece.y <= paddleY + PADDLE_HEIGHT/2 && piece.y >= paddleY - PADDLE_HEIGHT/2) ||
         (index === 1 && piece.y <= paddleY + PADDLE_HEIGHT/2 && piece.y >= paddleY - PADDLE_HEIGHT/2)) &&
        (piece.x >= playerState.paddleX - PADDLE_WIDTH/2 && piece.x <= playerState.paddleX + PADDLE_WIDTH/2)
      ) {
        // Bounce in opposite direction
        piece.velocityY = -piece.velocityY * BOUNCE_DAMPING
        
        // Add slight x velocity based on where it hit the paddle
        const hitPosition = (piece.x - playerState.paddleX) / (PADDLE_WIDTH/2)
        piece.velocityX += hitPosition * 2 // Adds some angle to the bounce
        
        // Move the piece out of the paddle to prevent multiple bounces
        piece.y = index === 0 ? paddleY + PADDLE_HEIGHT/2 + PIECE_RADIUS : paddleY - PADDLE_HEIGHT/2 - PIECE_RADIUS
      }
    })

    // Check for scoring
    if (piece.y < SCORE_ZONE_HEIGHT && piece.ownerId === playerIds[1]) {
      // Player 1 scored a point against Player 2
      players[playerIds[0]].score += 1
      piece.y = -10 // Move piece out of play
    } else if (piece.y > BOARD_HEIGHT - SCORE_ZONE_HEIGHT && piece.ownerId === playerIds[0]) {
      // Player 2 scored a point against Player 1
      players[playerIds[1]].score += 1
      piece.y = BOARD_HEIGHT + 10 // Move piece out of play
    }
  })

  return isGameOver
}

Rune.initLogic({
  minPlayers: 2,
  maxPlayers: 2,
  setup: (allPlayerIds) => {
    // Create initial player states
    const players: { [playerId: string]: PlayerState } = {}
    allPlayerIds.forEach(id => {
      players[id] = {
        paddleX: BOARD_WIDTH / 2,
        score: 0,
        ready: false
      }
    })

    // Create initial pieces
    const pieces = createInitialPieces(INITIAL_PIECES_COUNT)
    
    // Initialize visibility for all pieces for all players
    pieces.forEach(piece => {
      allPlayerIds.forEach(id => {
        piece.isVisible[id] = true // All pieces are visible to all players at start
      })
    })

    return {
      pieces,
      players,
      gamePhase: "WAITING",
      lastMovePlayerId: null,
      playerIds: allPlayerIds,
      winnerPlayerId: null
    }
  },
  update: ({ game }) => {
    if (game.gamePhase !== "PLAYING") return

    const isGameOver = updatePiecePositions(game.pieces, game.players, game.playerIds)
    
    if (isGameOver) {
      game.gamePhase = "GAME_OVER"
      
      // Determine winner
      const player1 = game.playerIds[0]
      const player2 = game.playerIds[1]
      
      if (game.players[player1].score > game.players[player2].score) {
        game.winnerPlayerId = player1
        Rune.gameOver({
          players: {
            [player1]: "WON",
            [player2]: "LOST",
          },
        })
      } else if (game.players[player2].score > game.players[player1].score) {
        game.winnerPlayerId = player2
        Rune.gameOver({
          players: {
            [player1]: "LOST",
            [player2]: "WON",
          },
        })
      } else {
        // It's a tie
        game.winnerPlayerId = null
        Rune.gameOver({
          players: {
            [player1]: "DRAW",
            [player2]: "DRAW",
          },
        })
      }
    }
  },
  actions: {
    setReady: (_, { game, playerId }) => {
      if (game.gamePhase !== "WAITING") {
        throw Rune.invalidAction()
      }
      
      game.players[playerId].ready = true
      
      // Check if all players are ready
      const allReady = game.playerIds.every(id => game.players[id].ready)
      
      if (allReady) {
        game.gamePhase = "CLAIMING"
      }
    },
    claimPiece: (pieceId, { game, playerId }) => {
      if (game.gamePhase !== "CLAIMING") {
        throw Rune.invalidAction()
      }
      
      const piece = game.pieces.find(p => p.id === pieceId)
      if (!piece || piece.ownerId) {
        throw Rune.invalidAction()
      }
      
      // Check if piece is at the center line
      if (Math.abs(piece.y - CENTER_LINE) > PIECE_RADIUS) {
        throw Rune.invalidAction()
      }
      
      // Claim the piece
      piece.ownerId = playerId
      
      // Move the piece slightly into the player's territory
      const playerIndex = game.playerIds.indexOf(playerId)
      piece.y = playerIndex === 0 ? CENTER_LINE - PIECE_RADIUS * 2 : CENTER_LINE + PIECE_RADIUS * 2
      
      // Update visibility
      game.playerIds.forEach(id => {
        // Only visible to the owner after claiming
        piece.isVisible[id] = (id === playerId)
      })
      
      // Check if all pieces are claimed
      const allClaimed = game.pieces.every(p => p.ownerId !== null)
      
      if (allClaimed) {
        game.gamePhase = "PLAYING"
      }
    },
    movePaddle: (x, { game, playerId }) => {
      if (game.gamePhase !== "PLAYING" && game.gamePhase !== "CLAIMING") {
        throw Rune.invalidAction()
      }
      
      // Clamp paddle position to board width
      const clampedX = Math.max(PADDLE_WIDTH/2, Math.min(BOARD_WIDTH - PADDLE_WIDTH/2, x))
      
      game.players[playerId].paddleX = clampedX
    },
    flick: (pieceId, velocityX, velocityY, { game, playerId }) => {
      if (game.gamePhase !== "PLAYING") {
        throw Rune.invalidAction()
      }
      
      const piece = game.pieces.find(p => p.id === pieceId)
      if (!piece || piece.ownerId !== playerId) {
        throw Rune.invalidAction()
      }
      
      // Apply the flick with some maximum velocity constraints
      const maxVelocity = 15
      piece.velocityX = Math.max(-maxVelocity, Math.min(maxVelocity, velocityX))
      piece.velocityY = Math.max(-maxVelocity, Math.min(maxVelocity, velocityY))
      
      // Update last move player
      game.lastMovePlayerId = playerId
    }
  },
})
