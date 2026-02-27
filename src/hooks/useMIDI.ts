import { useEffect, useState, useCallback } from 'react'
import { NoteEvent } from '../types/music'

interface UseMIDIResult {
  isSupported: boolean
  isConnected: boolean
  devices: WebMidi.MIDIInput[]
  selectedDevice: WebMidi.MIDIInput | null
  error: string | null
  connect: (device: WebMidi.MIDIInput) => void
  disconnect: () => void
  lastNoteEvent: NoteEvent | null
}

export function useMIDI(): UseMIDIResult {
  const [midiAccess, setMidiAccess] = useState<WebMidi.MIDIAccess | null>(null)
  const [isSupported, setIsSupported] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [devices, setDevices] = useState<WebMidi.MIDIInput[]>([])
  const [selectedDevice, setSelectedDevice] = useState<WebMidi.MIDIInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastNoteEvent, setLastNoteEvent] = useState<NoteEvent | null>(null)

  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      setIsSupported(false)
      setError('Web MIDI API 不受支持')
      return
    }

    navigator
      .requestMIDIAccess()
      .then((access) => {
        setMidiAccess(access)
        updateDevices(access)

        // Listen for device changes
        access.onstatechange = () => {
          updateDevices(access)
        }
      })
      .catch((err) => {
        setError(`MIDI 访问失败: ${err.message}`)
      })
  }, [])

  const updateDevices = (access: WebMidi.MIDIAccess) => {
    const inputs: WebMidi.MIDIInput[] = []
    access.inputs.forEach((input) => {
      inputs.push(input)
    })
    setDevices(inputs)
  }

  const handleMIDIMessage = useCallback((event: WebMidi.MIDIMessageEvent) => {
    const [status, data1, data2] = event.data
    const command = status & 0xf0
    const channel = status & 0x0f

    if (command === 0x90 && data2 > 0) {
      // Note On
      const noteEvent: NoteEvent = {
        id: crypto.randomUUID(),
        pitch: {
          midiNote: data1,
          octave: Math.floor(data1 / 12) - 1,
          step: data1 % 12,
        },
        velocity: data2,
        timestamp: Date.now(),
        type: 'noteOn',
      }
      setLastNoteEvent(noteEvent)
    } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      // Note Off
      const noteEvent: NoteEvent = {
        id: crypto.randomUUID(),
        pitch: {
          midiNote: data1,
          octave: Math.floor(data1 / 12) - 1,
          step: data1 % 12,
        },
        velocity: 0,
        timestamp: Date.now(),
        type: 'noteOff',
      }
      setLastNoteEvent(noteEvent)
    }
  }, [])

  const connect = useCallback(
    (device: WebMidi.MIDIInput) => {
      if (selectedDevice) {
        selectedDevice.onmidimessage = null
      }

      device.onmidimessage = handleMIDIMessage
      setSelectedDevice(device)
      setIsConnected(true)
      setError(null)
    },
    [selectedDevice, handleMIDIMessage]
  )

  const disconnect = useCallback(() => {
    if (selectedDevice) {
      selectedDevice.onmidimessage = null
      setSelectedDevice(null)
      setIsConnected(false)
    }
  }, [selectedDevice])

  return {
    isSupported,
    isConnected,
    devices,
    selectedDevice,
    error,
    connect,
    disconnect,
    lastNoteEvent,
  }
}
