import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Note, Pitch } from '../types/music'

interface StaffProps {
  notes: Note[]
  currentNoteIndex: number
  onNoteClick?: (index: number) => void
}

export function Staff({ notes, currentNoteIndex, onNoteClick }: StaffProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize] = useState({ width: 800, height: 200 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw staff
    drawStaff(ctx, canvasSize)

    // Draw notes
    notes.forEach((note, index) => {
      const isCurrent = index === currentNoteIndex
      const isPast = index < currentNoteIndex
      drawNote(ctx, note, index, isCurrent, isPast, canvasSize)
    })

    // Draw cursor
    drawCursor(ctx, currentNoteIndex, canvasSize)
  }, [notes, currentNoteIndex, canvasSize])

  const drawStaff = (ctx: CanvasRenderingContext2D, size: { width: number; height: number }) => {
    const lineSpacing = 12
    const startY = size.height / 2 - 30
    const leftMargin = 60

    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1

    // Draw 5 staff lines
    for (let i = 0; i < 5; i++) {
      const y = startY + i * lineSpacing
      ctx.beginPath()
      ctx.moveTo(leftMargin, y)
      ctx.lineTo(size.width - 20, y)
      ctx.stroke()
    }

    // Draw treble clef (simplified)
    ctx.font = '50px serif'
    ctx.fillText('𝄞', leftMargin + 5, startY + 35)
  }

  const drawNote = (
    ctx: CanvasRenderingContext2D,
    note: Note,
    index: number,
    isCurrent: boolean,
    isPast: boolean,
    size: { width: number; height: number }
  ) => {
    const lineSpacing = 12
    const startY = size.height / 2 - 30
    const leftMargin = 60
    const noteSpacing = 40

    const x = leftMargin + 60 + index * noteSpacing
    const y = getNoteYPosition(note.pitch, startY, lineSpacing)

    // Set color based on state
    if (isCurrent) {
      ctx.fillStyle = '#007ACC'
      ctx.strokeStyle = '#007ACC'
    } else if (isPast) {
      ctx.fillStyle = '#999'
      ctx.strokeStyle = '#999'
    } else {
      ctx.fillStyle = '#000'
      ctx.strokeStyle = '#000'
    }

    // Draw note head
    ctx.beginPath()
    ctx.ellipse(x, y, 6, 4.5, 0, 0, Math.PI * 2)
    
    if (note.duration === 'whole' || note.duration === 'half') {
      ctx.stroke()
    } else {
      ctx.fill()
    }

    // Draw stem
    if (note.duration !== 'whole') {
      ctx.lineWidth = 1.5
      ctx.beginPath()
      if (y > startY + 30) {
        ctx.moveTo(x + 5, y)
        ctx.lineTo(x + 5, y - 35)
      } else {
        ctx.moveTo(x - 5, y)
        ctx.lineTo(x - 5, y + 35)
      }
      ctx.stroke()
    }
  }

  const drawCursor = (
    ctx: CanvasRenderingContext2D,
    noteIndex: number,
    size: { width: number; height: number }
  ) => {
    const startY = size.height / 2 - 30
    const leftMargin = 60
    const noteSpacing = 40

    const x = leftMargin + 60 + noteIndex * noteSpacing

    ctx.fillStyle = 'rgba(0, 122, 204, 0.3)'
    ctx.fillRect(x - 15, startY - 15, 30, 80)
  }

  const handleCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!onNoteClick) return

    const rect = event.currentTarget.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const leftMargin = 60
    const noteSpacing = 40
    const firstNoteX = leftMargin + 60
    const noteIndex = Math.floor((clickX - firstNoteX + noteSpacing / 2) / noteSpacing)

    if (noteIndex >= 0 && noteIndex < notes.length) {
      onNoteClick(noteIndex)
    }
  }

  const getNoteYPosition = (pitch: Pitch, startY: number, lineSpacing: number): number => {
    const baseY = startY + 4 * lineSpacing
    const midiDiff = pitch.midiNote - 60
    const lineDiff = midiDiff / 2
    return baseY - lineDiff * lineSpacing
  }

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize.width}
      height={canvasSize.height}
      onClick={handleCanvasClick}
      className="w-full bg-white rounded-lg shadow"
      style={{ maxWidth: '100%' }}
    />
  )
}
