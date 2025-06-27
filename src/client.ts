import "./styles.css"

import { PlayerId } from "rune-sdk"

import { Piece, PlayerState, GameState } from "./logic.ts"

// Sound effects
const selectSound = new Audio("./assets/select.wav")
// TODO: Replace with a dedicated bounce sound
const bounceSound = new Audio("./assets/select.wav")
// TODO: Replace with a dedicated score sound
const scoreSound = new Audio("./assets/select.wav")

// Canvas references
let canvas: HTMLCanvasElement
let ctx: CanvasRenderingContext2D

// Game state references
let game: GameState // Declare game as a global variable
let gamePhase = "WAITING"
let myPlayerId: PlayerId | undefined
let myPlayerIndex = -1
let players: { [playerId: string]: PlayerState } = {}
let pieces: Piece[] = []

let playerIds: PlayerId[] = []

// To store previous state for sound/haptic comparison
let previousPlayers: { [playerId: string]: PlayerState } = {}
let previousPieces: Piece[] = []

// Interaction state
let isDragging = false
let draggedPieceId: number | null = null
let dragStartX = 0
let dragStartY = 0
let flickDirection = { x: 0, y: 0 }

// Constants (must match server constants)
const BOARD_WIDTH = 100
const BOARD_HEIGHT = 200
const CENTER_LINE = BOARD_HEIGHT / 2
const PIECE_RADIUS = 5
const PADDLE_WIDTH = 30
const PADDLE_HEIGHT = 5
const PLAYER1_PADDLE_Y = 15
const PLAYER2_PADDLE_Y = BOARD_HEIGHT - 15
const SCORE_ZONE_HEIGHT = 10
const BOT_ID = "bot"

// Scaling factors
let scaleX = 1
let scaleY = 1

// Haptic feedback helper
function triggerHapticFeedback(pattern: number | number[] = 10) {
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch (e) {
      // Silently fail if vibration is not supported or fails
    }
  }
}

function initUI() {
  canvas = document.createElement("canvas")
  canvas.id = "gameCanvas"
  document.getElementById("game-container")!.appendChild(canvas)

  ctx = canvas.getContext("2d")!
  resizeCanvas()

  window.addEventListener("resize", resizeCanvas)
  canvas.addEventListener("mousedown", handleMouseDown)
  canvas.addEventListener("mousemove", handleMouseMove)
  canvas.addEventListener("mouseup", handleMouseUp)
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false })
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false })
  canvas.addEventListener("touchend", handleTouchEnd, { passive: false })
}

function resizeCanvas() {
  const container = document.getElementById("game-container")!
  const containerWidth = container.clientWidth
  const containerHeight = container.clientHeight

  const aspectRatio = BOARD_WIDTH / BOARD_HEIGHT
  let width = containerWidth
  let height = width / aspectRatio

  if (height > containerHeight) {
    height = containerHeight
    width = height * aspectRatio
  }

  canvas.width = width
  canvas.height = height

  scaleX = width / BOARD_WIDTH
  scaleY = height / BOARD_HEIGHT
}

function gameToScreenX(x: number): number {
  return x * scaleX
}

function gameToScreenY(y: number): number {
  return y * scaleY
}

function screenToGameX(x: number): number {
  return x / scaleX
}

function screenToGameY(y: number): number {
  return y / scaleY
}

function handleMouseDown(e: MouseEvent) {
  e.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const x = screenToGameX(e.clientX - rect.left)
  const y = screenToGameY(e.clientY - rect.top)
  handleInteractionStart(x, y)
}

function handleMouseMove(e: MouseEvent) {
  e.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const x = screenToGameX(e.clientX - rect.left)
  const y = screenToGameY(e.clientY - rect.top)
  handleInteractionMove(x, y)
}

function handleMouseUp() {
  handleInteractionEnd()
}

function handleTouchStart(e: TouchEvent) {
  e.preventDefault()
  if (e.touches.length === 0) return

  const touch = e.touches[0]
  const rect = canvas.getBoundingClientRect()
  const x = screenToGameX(touch.clientX - rect.left)
  const y = screenToGameY(touch.clientY - rect.top)
  handleInteractionStart(x, y)
}

function handleTouchMove(e: TouchEvent) {
  e.preventDefault()
  if (e.touches.length === 0) return

  const touch = e.touches[0]
  const rect = canvas.getBoundingClientRect()
  const x = screenToGameX(touch.clientX - rect.left)
  const y = screenToGameY(touch.clientY - rect.top)
  handleInteractionMove(x, y)
}

function handleTouchEnd() {
  handleInteractionEnd()
}

function handleInteractionStart(x: number, y: number) {
  if (!myPlayerId || myPlayerIndex === -1) return

  if (gamePhase === "WAITING") {
    const buttonWidth = 40
    const buttonHeight = 20
    const buttonCenterX = BOARD_WIDTH / 2
    const buttonCenterY =
      myPlayerIndex === 0 ? BOARD_HEIGHT / 4 : (BOARD_HEIGHT * 3) / 4

    if (
      x >= buttonCenterX - buttonWidth / 2 &&
      x <= buttonCenterX + buttonWidth / 2 &&
      y >= buttonCenterY - buttonHeight / 2 &&
      y <= buttonCenterY + buttonHeight / 2
    ) {
      Rune.actions.setReady()
    }
  } else if (gamePhase === "CLAIMING") {
    for (const piece of pieces) {
      if (
        piece.ownerId === null &&
        Math.hypot(piece.x - x, piece.y - y) < PIECE_RADIUS * 2
      ) {
        isDragging = true
        draggedPieceId = piece.id
        return
      }
    }
  } else if (gamePhase === "PLAYING") {
    for (const piece of pieces) {
      if (
        piece.ownerId === myPlayerId &&
        piece.isVisible[myPlayerId] &&
        Math.hypot(piece.x - x, piece.y - y) < PIECE_RADIUS * 2
      ) {
        isDragging = true
        draggedPieceId = piece.id
        dragStartX = x
        dragStartY = y
        return
      }
    }
  }
}

function handleInteractionMove(x: number, y: number) {
  if (!myPlayerId || myPlayerIndex === -1) return

  if (isDragging && draggedPieceId !== null) {
    if (gamePhase === "CLAIMING") {
      const piece = pieces.find(p => p.id === draggedPieceId)
      if (!piece) return

      piece.x = x
      piece.y = y

      const playerIndex = playerIds.indexOf(myPlayerId)
      const isPlayer1 = playerIndex === 0

      if ((isPlayer1 && y < CENTER_LINE) || (!isPlayer1 && y > CENTER_LINE)) {
        Rune.actions.claimPiece({ pieceId: draggedPieceId, x, y })
        isDragging = false
        draggedPieceId = null
      }
    } else if (gamePhase === "PLAYING") {
      flickDirection = {
        x: dragStartX - x,
        y: dragStartY - y,
      }
    }
  }
  // Only move paddle if not dragging a piece
  else {
    Rune.actions.movePaddle(x)
  }
}

function handleInteractionEnd() {
  if (!myPlayerId || myPlayerIndex === -1) return

  if (isDragging && draggedPieceId !== null) {
    if (gamePhase === "PLAYING") {
      const magnitude = Math.hypot(flickDirection.x, flickDirection.y)

      if (magnitude > 1) {
        const velocityScale = Math.min(magnitude, 20) / 10
        const velocityX = flickDirection.x * velocityScale
        const velocityY = flickDirection.y * velocityScale

        Rune.actions.flick({ pieceId: draggedPieceId, velocityX, velocityY })
        triggerHapticFeedback(20)
      }
    }
  }

  isDragging = false
  draggedPieceId = null
  flickDirection = { x: 0, y: 0 }
}

function draw() {
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawBoard()
  drawScoreZones()
  drawCenterLine()
  drawPieces()
  drawPaddles()

  if (gamePhase === "WAITING") {
    drawStartScreen()
  } else if (gamePhase === "GAME_OVER") {
    drawGameOverScreen()
  }

  if (isDragging && draggedPieceId !== null && gamePhase === "PLAYING") {
    drawFlickGuide()
  }

  drawScores()
  requestAnimationFrame(draw)
}

function drawBoard() {
  ctx.fillStyle = "#b2773f"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.save()
  ctx.globalAlpha = 0.05
  ctx.fillStyle = "#000000"
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * canvas.width
    const y = Math.random() * canvas.height
    const width = Math.random() * 20 + 10
    const height = Math.random() * 2 + 1
    ctx.fillRect(x, y, width, height)
  }
  ctx.restore()
}

function drawCenterLine() {
  ctx.save()
  ctx.shadowColor = "rgba(255, 255, 255, 0.8)"
  ctx.shadowBlur = 10 * scaleY
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"
  ctx.lineWidth = 2 * scaleY
  ctx.beginPath()
  ctx.moveTo(0, gameToScreenY(CENTER_LINE))
  ctx.lineTo(canvas.width, gameToScreenY(CENTER_LINE))
  ctx.stroke()
  ctx.restore()
}

function drawScoreZones() {
  ctx.save()
  ctx.fillStyle = "rgba(255, 100, 100, 0.2)"
  ctx.fillRect(0, 0, canvas.width, gameToScreenY(SCORE_ZONE_HEIGHT))
  ctx.fillStyle = "rgba(100, 100, 255, 0.2)"
  ctx.fillRect(
    0,
    gameToScreenY(BOARD_HEIGHT - SCORE_ZONE_HEIGHT),
    canvas.width,
    gameToScreenY(SCORE_ZONE_HEIGHT)
  )
  ctx.restore()
}

function drawPieces() {
  if (!pieces || !myPlayerId) return

  ctx.save()
  pieces.forEach(piece => {
    if (!piece.isVisible[myPlayerId!]) return

    const x = gameToScreenX(piece.x)
    const y = gameToScreenY(piece.y)
    const radius = gameToScreenX(PIECE_RADIUS)

    let fillColor = "#dddddd"
    let strokeColor = "#999999"

    if (piece.ownerId) {
      fillColor = piece.ownerId === playerIds[0] ? "#e74c3c" : "#3498db"
      strokeColor = piece.ownerId === playerIds[0] ? "#c0392b" : "#2980b9"
    }

    ctx.beginPath()
    ctx.arc(x + radius * 0.1, y + radius * 0.1, radius, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)"
    ctx.fill()

    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = fillColor
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = radius * 0.2
    ctx.fill()
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.4, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.fill()
  })
  ctx.restore()
}

function drawPaddles() {
  if (!players || !playerIds || !myPlayerId) return

  ctx.save()
  playerIds.forEach((playerId, index) => {
    if (playerId !== myPlayerId) return

    const playerState = players[playerId]
    if (!playerState) return

    const paddleX = gameToScreenX(playerState.paddleX)
    const paddleY = gameToScreenY(
      index === 0 ? PLAYER1_PADDLE_Y : PLAYER2_PADDLE_Y
    )
    const paddleWidth = gameToScreenX(PADDLE_WIDTH)
    const paddleHeight = gameToScreenY(PADDLE_HEIGHT)

    ctx.fillStyle = "rgba(0, 0, 0, 0.4)"
    ctx.fillRect(
      paddleX - paddleWidth / 2 + paddleHeight * 0.2,
      paddleY - paddleHeight / 2 + paddleHeight * 0.2,
      paddleWidth,
      paddleHeight
    )

    const gradient = ctx.createLinearGradient(
      paddleX - paddleWidth / 2,
      paddleY - paddleHeight / 2,
      paddleX - paddleWidth / 2,
      paddleY + paddleHeight / 2
    )

    if (index === 0) {
      gradient.addColorStop(0, "#c0392b")
      gradient.addColorStop(1, "#e74c3c")
    } else {
      gradient.addColorStop(0, "#2980b9")
      gradient.addColorStop(1, "#3498db")
    }

    ctx.fillStyle = gradient
    ctx.fillRect(
      paddleX - paddleWidth / 2,
      paddleY - paddleHeight / 2,
      paddleWidth,
      paddleHeight
    )

    ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
    ctx.fillRect(
      paddleX - paddleWidth / 2,
      paddleY - paddleHeight / 2,
      paddleWidth,
      paddleHeight * 0.3
    )
  })
  ctx.restore()
}

function drawFlickGuide() {
  if (draggedPieceId === null) return

  const piece = pieces.find(p => p.id === draggedPieceId)
  if (!piece) return

  ctx.save()
  const startX = gameToScreenX(piece.x)
  const startY = gameToScreenY(piece.y)
  const endX = startX - gameToScreenX(flickDirection.x)
  const endY = startY - gameToScreenY(flickDirection.y)

  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)"
  ctx.lineWidth = 2 * scaleX
  ctx.setLineDash([5 * scaleX, 5 * scaleX])
  ctx.beginPath()
  ctx.moveTo(startX, startY)
  ctx.lineTo(endX, endY)
  ctx.stroke()

  const magnitude = Math.hypot(flickDirection.x, flickDirection.y)
  const powerRadius = Math.min(magnitude * scaleX * 0.2, 20 * scaleX)
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)"
  ctx.beginPath()
  ctx.arc(endX, endY, powerRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawStartScreen() {
  console.log("drawStartScreen called.");
  console.log("players:", players);
  console.log("myPlayerId:", myPlayerId);
  console.log("players[myPlayerId]:", players[myPlayerId]);

  if (!players || !myPlayerId || !players[myPlayerId]) return

  ctx.save()
  const buttonWidth = gameToScreenX(40)
  const buttonHeight = gameToScreenY(20)
  const buttonX = canvas.width / 2 - buttonWidth / 2
  const buttonY =
    myPlayerIndex === 0
      ? gameToScreenY(BOARD_HEIGHT / 4) - buttonHeight / 2
      : gameToScreenY((BOARD_HEIGHT * 3) / 4) - buttonHeight / 2

  if (players[myPlayerId].ready) {
    ctx.font = `${Math.round(buttonHeight * 0.6)}px Arial`
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(
      "Waiting for opponent...",
      canvas.width / 2,
      myPlayerIndex === 0
        ? gameToScreenY(BOARD_HEIGHT / 4)
        : gameToScreenY((BOARD_HEIGHT * 3) / 4)
    )
  }
  // Only draw the start button if the current player is not ready
  else {
    const gradient = ctx.createLinearGradient(
      buttonX,
      buttonY,
      buttonX + buttonWidth,
      buttonY
    )
    gradient.addColorStop(0, "#3498db")
    gradient.addColorStop(1, "#2980b9")

    ctx.fillStyle = gradient
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)"
    ctx.shadowBlur = 5
    ctx.shadowOffsetY = 3
    ctx.beginPath()
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, buttonHeight * 0.3)
    ctx.fill()

    ctx.font = `${Math.round(buttonHeight * 0.6)}px Arial`
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.fillText(
      "Start",
      canvas.width / 2,
      myPlayerIndex === 0
        ? gameToScreenY(BOARD_HEIGHT / 4)
        : gameToScreenY((BOARD_HEIGHT * 3) / 4)
    )
  }
  ctx.restore()
}

function drawGameOverScreen() {
  ctx.save()
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.font = `${Math.round(30 * scaleY)}px Arial`
  ctx.fillStyle = "white"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("Game Over", canvas.width / 2, canvas.height / 3)

  if (myPlayerId && players[myPlayerId]) {
    const player1 = playerIds[0]
    const player2 = playerIds[1]

    let resultText = "It's a draw!"

    if (players[player1].score > players[player2].score) {
      resultText = player1 === myPlayerId ? "You won!" : "You lost!"
    } else if (players[player2].score > players[player1].score) {
      resultText = player2 === myPlayerId ? "You won!" : "You lost!"
    }

    ctx.font = `${Math.round(20 * scaleY)}px Arial`
    ctx.fillText(resultText, canvas.width / 2, canvas.height / 2)

    ctx.font = `${Math.round(16 * scaleY)}px Arial`
    ctx.fillText(
      `Score: ${players[player1].score} - ${players[player2].score}`,
      canvas.width / 2,
      (canvas.height * 2) / 3
    )
  }
  ctx.restore()
}

function drawScores() {
  if (!players || !playerIds || !players[playerIds[0]] || !players[playerIds[1]])
    return

  ctx.save()
  const player1 = playerIds[0]
  const player2 = playerIds[1] // FIX: Corrected from playerIds[0]

  ctx.font = `${Math.round(16 * scaleY)}px Arial`
  ctx.fillStyle = "#e74c3c"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  ctx.fillText(`P1: ${players[player1].score}`, gameToScreenX(5), gameToScreenY(5))

  ctx.fillStyle = "#3498db"
  ctx.textAlign = "left"
  ctx.textBaseline = "bottom"
  ctx.fillText(
    `P2: ${players[player2].score}`,
    gameToScreenX(5),
    gameToScreenY(BOARD_HEIGHT - 5)
  )
  ctx.restore()
}

// New function to handle bot actions
function handleBotActions() {
  // Only dispatch bot actions during active gameplay phases
  if (game && (game.gamePhase === "PLAYING" || game.gamePhase === "CLAIMING")) {
    if (game.botAction) {
      if (game.botAction.name === "claimPiece") {
        Rune.actions.claimPiece(game.botAction.data)
      } else if (game.botAction.name === "movePaddle") {
        Rune.actions.movePaddle(game.botAction.data)
      } else if (game.botAction.name === "flick") {
        Rune.actions.flick(game.botAction.data)
      }
      // Clear the bot action after dispatching
      Rune.actions.clearBotAction()
    }
  }
  requestAnimationFrame(handleBotActions) // Continuously call itself
}

Rune.initClient({
  onChange: ({ game: newGame, yourPlayerId, action }) => {
    console.log("onChange triggered.");
    console.log("newGame:", newGame);
    console.log("yourPlayerId:", yourPlayerId);
    console.log("action:", action);

    // Store current global state as previous state for sound/haptic comparison
    previousPlayers = players
    previousPieces = pieces

    // Update global game object and derived state variables
    game = newGame
    players = game.players
    playerIds = game.playerIds
    gamePhase = game.gamePhase
    myPlayerId = yourPlayerId
    myPlayerIndex = yourPlayerId ? playerIds.indexOf(yourPlayerId) : -1

    console.log("Global state after update:");
    console.log("game:", game);
    console.log("players:", players);
    console.log("playerIds:", playerIds);
    console.log("gamePhase:", gamePhase);
    console.log("myPlayerId:", myPlayerId);
    console.log("myPlayerIndex:", myPlayerIndex);

    // Defensive check for game.pieces before stringifying
    let piecesToProcess = game.pieces;
    if (!Array.isArray(piecesToProcess)) {
      console.warn("game.pieces is not an array, treating as empty for JSON.stringify:", piecesToProcess);
      piecesToProcess = [];
    }

    // Deep copy pieces to allow local manipulation (e.g., dragging)
    try {
      const stringified = JSON.stringify(piecesToProcess);
      pieces = JSON.parse(stringified);
    } catch (e) {
      console.error("Error during JSON.parse/stringify of pieces:", e);
      console.error("Original game.pieces:", game.pieces);
      // Fallback to empty array to prevent further errors
      pieces = [];
    }
    console.log("pieces after JSON processing:", pieces);

    // Initialize UI and start loops only once
    if (!canvas) {
      console.log("Initializing UI and starting animation loops.");
      initUI()
      requestAnimationFrame(draw)
      requestAnimationFrame(handleBotActions)
    }

    // Detect and play sounds/haptics based on state changes
    if (gamePhase === "PLAYING") {
      // Score sounds
      for (const playerId of playerIds) {
        if (
          players[playerId].score > (previousPlayers[playerId]?.score ?? 0) &&
          (pieces.length > 0 || previousPieces.length > 0)
        ) {
          scoreSound.play()
          triggerHapticFeedback([50, 50, 50])
        }
      }

      // Bounce sounds
      for (const newPiece of pieces) {
        const oldPiece = previousPieces.find(p => p.id === newPiece.id)
        if (oldPiece) {
          if (Math.sign(newPiece.velocityX) !== Math.sign(oldPiece.velocityX)) {
            bounceSound.play()
            triggerHapticFeedback(10)
          }
          if (Math.sign(newPiece.velocityY) !== Math.sign(oldPiece.velocityY)) {
            bounceSound.play()
            triggerHapticFeedback(10)
          }
        }
      }
    }

    // Handle action sounds (these are based on the `action` object directly)
    if (action) {
      if (action.name === "claimPiece" || action.name === "flick") {
        selectSound.play()
      }
    }
  },
})