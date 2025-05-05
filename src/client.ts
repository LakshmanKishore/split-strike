import "./styles.css"

import { PlayerId } from "rune-sdk"

import selectSoundAudio from "./assets/select.wav"
import { Piece, PlayerState } from "./logic.ts"

// Sound effects
const selectSound = new Audio(selectSoundAudio)

// Canvas references
let canvas: HTMLCanvasElement
let ctx: CanvasRenderingContext2D

// Game state references
let gamePhase = "WAITING"
let myPlayerId: PlayerId | undefined
let myPlayerIndex = -1
let players: { [playerId: string]: PlayerState } = {}
let pieces: Piece[] = []
let playerIds: PlayerId[] = []

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
const PLAYER1_PADDLE_Y = CENTER_LINE - 15
const PLAYER2_PADDLE_Y = CENTER_LINE + 15
const SCORE_ZONE_HEIGHT = 10

// Scaling factors
let scaleX = 1
let scaleY = 1

function initUI() {
  // Create canvas
  canvas = document.createElement('canvas')
  canvas.id = 'gameCanvas'
  document.getElementById('game-container')!.appendChild(canvas)
  
  // Get context and set initial size
  ctx = canvas.getContext('2d')!
  resizeCanvas()
  
  // Add event listeners
  window.addEventListener('resize', resizeCanvas)
  canvas.addEventListener('mousedown', handleMouseDown)
  canvas.addEventListener('mousemove', handleMouseMove)
  canvas.addEventListener('mouseup', handleMouseUp)
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
  canvas.addEventListener('touchend', handleTouchEnd, { passive: false })
}

function resizeCanvas() {
  // Set canvas size based on window size with fixed aspect ratio
  const container = document.getElementById('game-container')!
  const containerWidth = container.clientWidth
  const containerHeight = container.clientHeight
  
  // Determine the maximum size that fits while maintaining aspect ratio
  const aspectRatio = BOARD_WIDTH / BOARD_HEIGHT
  let width = containerWidth
  let height = width / aspectRatio
  
  if (height > containerHeight) {
    height = containerHeight
    width = height * aspectRatio
  }
  
  canvas.width = width
  canvas.height = height
  
  // Calculate scale factors
  scaleX = width / BOARD_WIDTH
  scaleY = height / BOARD_HEIGHT
}

// Convert game coordinates to screen coordinates
function gameToScreenX(x: number): number {
  return x * scaleX
}

function gameToScreenY(y: number): number {
  return y * scaleY
}

// Convert screen coordinates to game coordinates
function screenToGameX(x: number): number {
  return x / scaleX
}

function screenToGameY(y: number): number {
  return y / scaleY
}

// Event Handlers
function handleMouseDown(e: MouseEvent) {
  e.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const x = screenToGameX(e.clientX - rect.left)
  const y = screenToGameY(e.clientY - rect.top)
  
  handleInteractionStart(x, y)
}

function handleMouseMove(e: MouseEvent) {
  e.preventDefault()
  if (!isDragging) return
  
  const rect = canvas.getBoundingClientRect()
  const x = screenToGameX(e.clientX - rect.left)
  const y = screenToGameY(e.clientY - rect.top)
  
  handleInteractionMove(x, y)
}

function handleMouseUp(e: MouseEvent) {
  e.preventDefault()
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
  if (!isDragging || e.touches.length === 0) return
  
  const touch = e.touches[0]
  const rect = canvas.getBoundingClientRect()
  const x = screenToGameX(touch.clientX - rect.left)
  const y = screenToGameY(touch.clientY - rect.top)
  
  handleInteractionMove(x, y)
}

function handleTouchEnd(e: TouchEvent) {
  e.preventDefault()
  handleInteractionEnd()
}

// Unified interaction handlers
function handleInteractionStart(x: number, y: number) {
  if (!myPlayerId || myPlayerIndex === -1) return
  
  if (gamePhase === "WAITING") {
    // Check if the user clicked the ready button
    const buttonCenterX = BOARD_WIDTH / 2
    const buttonCenterY = myPlayerIndex === 0 ? BOARD_HEIGHT / 4 : BOARD_HEIGHT * 3 / 4
    const buttonWidth = 40
    const buttonHeight = 20
    
    if (
      x >= buttonCenterX - buttonWidth / 2 &&
      x <= buttonCenterX + buttonWidth / 2 &&
      y >= buttonCenterY - buttonHeight / 2 &&
      y <= buttonCenterY + buttonHeight / 2
    ) {
      Rune.actions.setReady()
      return
    }
  } else if (gamePhase === "CLAIMING") {
    // Check if the user is trying to claim a piece
    for (const piece of pieces) {
      if (
        piece.ownerId === null &&
        Math.abs(piece.x - x) < PIECE_RADIUS * 2 &&
        Math.abs(piece.y - y) < PIECE_RADIUS * 2
      ) {
        Rune.actions.claimPiece(piece.id)
        return
      }
    }
    
    // Move paddle during claiming phase too
    Rune.actions.movePaddle(x)
  } else if (gamePhase === "PLAYING") {
    // First, check if we're interacting with our paddle
    const paddleY = myPlayerIndex === 0 ? PLAYER1_PADDLE_Y : PLAYER2_PADDLE_Y
    
    if (Math.abs(y - paddleY) < PADDLE_HEIGHT * 2) {
      // Move paddle
      Rune.actions.movePaddle(x)
      return
    }
    
    // Check if trying to drag a piece
    for (const piece of pieces) {
      if (
        piece.ownerId === myPlayerId &&
        piece.isVisible[myPlayerId] &&
        Math.abs(piece.x - x) < PIECE_RADIUS * 2 &&
        Math.abs(piece.y - y) < PIECE_RADIUS * 2
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
  
  if (gamePhase === "PLAYING" || gamePhase === "CLAIMING") {
    if (isDragging && draggedPieceId !== null) {
      // Calculate flick direction
      flickDirection = {
        x: dragStartX - x,
        y: dragStartY - y
      }
    } else {
      // Move paddle
      Rune.actions.movePaddle(x)
    }
  }
}

function handleInteractionEnd() {
  if (!myPlayerId || myPlayerIndex === -1) return
  
  if (gamePhase === "PLAYING" && isDragging && draggedPieceId !== null) {
    // Calculate velocity based on flick direction and magnitude
    const magnitude = Math.sqrt(flickDirection.x * flickDirection.x + flickDirection.y * flickDirection.y)
    
    if (magnitude > 1) { // Minimum threshold for a flick
      // Scale the velocity based on magnitude, with a cap
      const maxMagnitude = 20
      const velocityScale = Math.min(magnitude, maxMagnitude) / 10
      
      const velocityX = flickDirection.x * velocityScale
      const velocityY = flickDirection.y * velocityScale
      
      Rune.actions.flick(draggedPieceId, velocityX, velocityY)
    }
    
    // Reset dragging state
    isDragging = false
    draggedPieceId = null
    flickDirection = { x: 0, y: 0 }
  }
}

function draw() {
  if (!ctx) return
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  // Draw board background
  drawBoard()
  
  // Draw score zones
  drawScoreZones()
  
  // Draw center line
  drawCenterLine()
  
  // Draw pieces
  drawPieces()
  
  // Draw paddles
  drawPaddles()
  
  // Draw UI elements based on game phase
  if (gamePhase === "WAITING") {
    drawStartScreen()
  } else if (gamePhase === "GAME_OVER") {
    drawGameOverScreen()
  }
  
  // Draw dragging effect
  if (isDragging && draggedPieceId !== null) {
    drawFlickGuide()
  }
  
  // Draw scores
  drawScores()
  
  // Request next frame
  requestAnimationFrame(draw)
}

function drawBoard() {
  // Draw wooden board background
  ctx.fillStyle = '#b2773f' // Wooden color
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  // Add grain texture
  ctx.save()
  ctx.globalAlpha = 0.05
  ctx.fillStyle = '#000000'
  
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
  // Draw glowing center line
  ctx.save()
  
  // Glow effect
  ctx.shadowColor = 'rgba(255, 255, 255, 0.8)'
  ctx.shadowBlur = 10 * scaleY
  
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.lineWidth = 2 * scaleY
  
  ctx.beginPath()
  ctx.moveTo(0, gameToScreenY(CENTER_LINE))
  ctx.lineTo(canvas.width, gameToScreenY(CENTER_LINE))
  ctx.stroke()
  
  ctx.restore()
}

function drawScoreZones() {
  // Draw scoring trays
  ctx.save()
  
  // Player 1 score zone (top)
  ctx.fillStyle = 'rgba(255, 100, 100, 0.2)'
  ctx.fillRect(
    0,
    0,
    canvas.width,
    gameToScreenY(SCORE_ZONE_HEIGHT)
  )
  
  // Player 2 score zone (bottom)
  ctx.fillStyle = 'rgba(100, 100, 255, 0.2)'
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
    // Only draw pieces that are visible to this player
    if (!piece.isVisible[myPlayerId!]) return
    
    // Position
    const x = gameToScreenX(piece.x)
    const y = gameToScreenY(piece.y)
    const radius = gameToScreenX(PIECE_RADIUS)
    
    // Determine piece color based on owner
    let fillColor = '#dddddd' // Neutral color
    let strokeColor = '#999999'
    
    if (piece.ownerId) {
      if (piece.ownerId === playerIds[0]) {
        fillColor = '#e74c3c' // Player 1 color (red)
        strokeColor = '#c0392b'
      } else {
        fillColor = '#3498db' // Player 2 color (blue)
        strokeColor = '#2980b9'
      }
    }
    
    // Draw piece shadow
    ctx.beginPath()
    ctx.arc(x + radius * 0.1, y + radius * 0.1, radius, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.fill()
    
    // Draw piece
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = fillColor
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = radius * 0.2
    ctx.fill()
    ctx.stroke()
    
    // Add shine effect
    ctx.beginPath()
    ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.4, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.fill()
  })
  
  ctx.restore()
}

function drawPaddles() {
  if (!players || !playerIds || !myPlayerId) return
  
  ctx.save()
  
  playerIds.forEach((playerId, index) => {
    // Only draw your own paddle
    if (playerId !== myPlayerId) return
    
    const playerState = players[playerId]
    if (!playerState) return
    
    const paddleX = gameToScreenX(playerState.paddleX)
    const paddleY = gameToScreenY(index === 0 ? PLAYER1_PADDLE_Y : PLAYER2_PADDLE_Y)
    const paddleWidth = gameToScreenX(PADDLE_WIDTH)
    const paddleHeight = gameToScreenY(PADDLE_HEIGHT)
    
    // Draw paddle shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.fillRect(
      paddleX - paddleWidth / 2 + paddleHeight * 0.2,
      paddleY - paddleHeight / 2 + paddleHeight * 0.2,
      paddleWidth,
      paddleHeight
    )
    
    // Draw paddle
    const gradient = ctx.createLinearGradient(
      paddleX - paddleWidth / 2,
      paddleY - paddleHeight / 2,
      paddleX - paddleWidth / 2,
      paddleY + paddleHeight / 2
    )
    
    if (index === 0) {
      // Player 1 paddle
      gradient.addColorStop(0, '#c0392b')
      gradient.addColorStop(1, '#e74c3c')
    } else {
      // Player 2 paddle
      gradient.addColorStop(0, '#2980b9')
      gradient.addColorStop(1, '#3498db')
    }
    
    ctx.fillStyle = gradient
    ctx.fillRect(
      paddleX - paddleWidth / 2,
      paddleY - paddleHeight / 2,
      paddleWidth,
      paddleHeight
    )
    
    // Add shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
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
  
  // Calculate end point based on flick direction
  const endX = startX - gameToScreenX(flickDirection.x)
  const endY = startY - gameToScreenY(flickDirection.y)
  
  // Draw elastic line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.lineWidth = 2 * scaleX
  ctx.setLineDash([5 * scaleX, 5 * scaleX])
  
  ctx.beginPath()
  ctx.moveTo(startX, startY)
  ctx.lineTo(endX, endY)
  ctx.stroke()
  
  // Draw power indicator
  const magnitude = Math.sqrt(flickDirection.x * flickDirection.x + flickDirection.y * flickDirection.y)
  const powerRadius = Math.min(magnitude * scaleX * 0.2, 20 * scaleX)
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.beginPath()
  ctx.arc(endX, endY, powerRadius, 0, Math.PI * 2)
  ctx.fill()
  
  ctx.restore()
}

function drawStartScreen() {
  if (!players || !myPlayerId) return
  
  ctx.save()
  
  const buttonWidth = gameToScreenX(40)
  const buttonHeight = gameToScreenY(20)
  const buttonX = canvas.width / 2 - buttonWidth / 2
  const buttonY = myPlayerIndex === 0 
    ? gameToScreenY(BOARD_HEIGHT / 4) - buttonHeight / 2 
    : gameToScreenY(BOARD_HEIGHT * 3 / 4) - buttonHeight / 2
  
  // Don't show the button if the player is already ready
  if (players[myPlayerId].ready) {
    // Show waiting message
    ctx.font = `${Math.round(buttonHeight * 0.6)}px Arial`
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Waiting for opponent...', 
      canvas.width / 2, 
      myPlayerIndex === 0 ? gameToScreenY(BOARD_HEIGHT / 4) : gameToScreenY(BOARD_HEIGHT * 3 / 4)
    )
  } else {
    // Draw start button
    const gradient = ctx.createLinearGradient(
      buttonX, buttonY,
      buttonX + buttonWidth, buttonY
    )
    gradient.addColorStop(0, '#3498db')
    gradient.addColorStop(1, '#2980b9')
    
    ctx.fillStyle = gradient
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 5
    ctx.shadowOffsetY = 3
    
    // Button shape
    ctx.beginPath()
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, buttonHeight * 0.3)
    ctx.fill()
    
    // Button text
    ctx.font = `${Math.round(buttonHeight * 0.6)}px Arial`
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.fillText('Start', canvas.width / 2, 
      myPlayerIndex === 0 ? gameToScreenY(BOARD_HEIGHT / 4) : gameToScreenY(BOARD_HEIGHT * 3 / 4)
    )
  }
  
  ctx.restore()
}

function drawGameOverScreen() {
  ctx.save()
  
  // Semi-transparent overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  // Game over text
  ctx.font = `${Math.round(30 * scaleY)}px Arial`
  ctx.fillStyle = 'white'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Game Over', canvas.width / 2, canvas.height / 3)
  
  // Show winner
  if (myPlayerId) {
    const player1 = playerIds[0]
    const player2 = playerIds[1]
    
    let resultText = 'It\'s a draw!'
    
    if (players[player1].score > players[player2].score) {
      resultText = player1 === myPlayerId ? 'You won!' : 'You lost!'
    } else if (players[player2].score > players[player1].score) {
      resultText = player2 === myPlayerId ? 'You won!' : 'You lost!'
    }
    
    ctx.font = `${Math.round(20 * scaleY)}px Arial`
    ctx.fillText(resultText, canvas.width / 2, canvas.height / 2)
    
    // Show final score
    ctx.font = `${Math.round(16 * scaleY)}px Arial`
    ctx.fillText(
      `Score: ${players[player1].score} - ${players[player2].score}`,
      canvas.width / 2,
      canvas.height * 2 / 3
    )
  }
  
  ctx.restore()
}

function drawScores() {
  if (!players || !playerIds) return
  
  ctx.save()
  
  const player1 = playerIds[0]
  const player2 = playerIds[1]
  
  if (!players[player1] || !players[player2]) return
  
  // Player 1 score
  ctx.font = `${Math.round(16 * scaleY)}px Arial`
  ctx.fillStyle = '#e74c3c'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`P1: ${players[player1].score}`, gameToScreenX(5), gameToScreenY(5))
  
  // Player 2 score
  ctx.fillStyle = '#3498db'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(
    `P2: ${players[player2].score}`,
    gameToScreenX(5),
    gameToScreenY(BOARD_HEIGHT - 5)
  )
  
  ctx.restore()
}

Rune.initClient({
  onChange: ({ game, yourPlayerId, action }) => {
    const { pieces: newPieces, players: newPlayers, playerIds: newPlayerIds, gamePhase: newGamePhase } = game
    
    // Initialize UI if not already done
    if (!canvas) {
      myPlayerId = yourPlayerId
      myPlayerIndex = yourPlayerId ? newPlayerIds.indexOf(yourPlayerId) : -1
      initUI()
      requestAnimationFrame(draw)
    }
    
    // Update game state
    pieces = newPieces
    players = newPlayers
    playerIds = newPlayerIds
    gamePhase = newGamePhase
    
    // Play sounds if appropriate
    if (action) {
      if (action.name === "claimPiece" || action.name === "flick") {
        selectSound.play()
      }
    }
  },
})
