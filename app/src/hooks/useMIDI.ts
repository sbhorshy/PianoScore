import { useEffect, useState, useCallback } from 'react'
import type { NoteEvent } from '@/types/music'

interface UseMIDIResult {
  isSupported: boolean
  isConnected: boolean
  devices: MIDIInput[]
  selectedDevice: MIDIInput | null
  error: string | null
  connect: (device: MIDIInput) => void
  disconnect: () => void
  lastNoteEvent: NoteEvent | null
  // Output capabilities
  outputs: MIDIOutput[]
  selectedOutput: MIDIOutput | null
  connectOutput: (output: MIDIOutput) => void
  sendNoteOn: (midi: number, velocity?: number) => void
  sendNoteOff: (midi: number) => void
}

export function useMIDI(): UseMIDIResult {
  const [isSupported, setIsSupported] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [devices, setDevices] = useState<MIDIInput[]>([])
  const [selectedDevice, setSelectedDevice] = useState<MIDIInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastNoteEvent, setLastNoteEvent] = useState<NoteEvent | null>(null)

  // Output state
  const [outputs, setOutputs] = useState<MIDIOutput[]>([])
  const [selectedOutput, setSelectedOutput] = useState<MIDIOutput | null>(null)

  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      setIsSupported(false)
      setError('Web MIDI API 不受支持')
      return
    }

    navigator
      .requestMIDIAccess()
      .then((access) => {
        updateDevices(access)

        access.onstatechange = () => {
          updateDevices(access)
        }
      })
      .catch((err: Error) => {
        setError(`MIDI 访问失败: ${err.message}`)
      })
  }, [])

  const updateDevices = (access: MIDIAccess) => {
    const inputs: MIDIInput[] = []
    access.inputs.forEach((input) => {
      inputs.push(input)
    })
    setDevices(inputs)

    // Also enumerate outputs
    const midiOutputs: MIDIOutput[] = []
    access.outputs.forEach((output) => {
      midiOutputs.push(output)
    })
    setOutputs(midiOutputs)
  }

  const handleMIDIMessage = useCallback((event: MIDIMessageEvent) => {
    if (!event.data) return

    const [status, data1, data2] = event.data
    const command = status & 0xf0

    if (command === 0x90 && data2 > 0) {
      const noteEvent: NoteEvent = {
        id: crypto.randomUUID(),
        pitch: data1,
        velocity: data2,
        timestamp: Date.now(),
        type: 'noteOn',
      }
      setLastNoteEvent(noteEvent)
    } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      const noteEvent: NoteEvent = {
        id: crypto.randomUUID(),
        pitch: data1,
        velocity: 0,
        timestamp: Date.now(),
        type: 'noteOff',
      }
      setLastNoteEvent(noteEvent)
    }
  }, [])

  const connect = useCallback(
    (device: MIDIInput) => {
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

  // ── Output methods ──────────────────────────────────────────────────────

  const connectOutput = useCallback((output: MIDIOutput) => {
    setSelectedOutput(output)
  }, [])

  const sendNoteOn = useCallback(
    (midi: number, velocity: number = 127) => {
      if (selectedOutput) {
        selectedOutput.send([0x90, midi & 0x7f, velocity & 0x7f])
      }
    },
    [selectedOutput]
  )

  const sendNoteOff = useCallback(
    (midi: number) => {
      if (selectedOutput) {
        selectedOutput.send([0x80, midi & 0x7f, 0x00])
      }
    },
    [selectedOutput]
  )

  return {
    isSupported,
    isConnected,
    devices,
    selectedDevice,
    error,
    connect,
    disconnect,
    lastNoteEvent,
    // Outputs
    outputs,
    selectedOutput,
    connectOutput,
    sendNoteOn,
    sendNoteOff,
  }
}
