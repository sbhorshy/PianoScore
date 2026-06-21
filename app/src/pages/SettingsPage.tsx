import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Piano, Music, Settings2, SlidersHorizontal, Wifi, WifiOff, AlertCircle } from 'lucide-react'
import { useMIDI } from '@/hooks/useMIDI'
import { useSettings } from '@/hooks/useSettings'

export default function SettingsPage() {
  const midi = useMIDI()
  const { settings, update } = useSettings()

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2 mb-2">
        <Settings2 className="h-6 w-6" />
        <h2 className="text-2xl font-bold">Settings</h2>
      </div>

      {/* MIDI Devices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Piano className="h-5 w-5" />
            MIDI Devices
          </CardTitle>
          <CardDescription>
            Configure your MIDI keyboard connection.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!midi.isSupported ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>MIDI Not Supported</AlertTitle>
              <AlertDescription>
                The Web MIDI API is not available in this browser. Please use a compatible browser like
                Google Chrome or Microsoft Edge.
              </AlertDescription>
            </Alert>
          ) : midi.isConnected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wifi className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium">
                    {midi.selectedDevice?.name || 'Connected Device'}
                  </p>
                </div>
                <Badge variant="default" className="bg-green-600 hover:bg-green-600">
                  Connected
                </Badge>
              </div>
              <Button onClick={midi.disconnect} variant="outline" size="sm">
                Disconnect
              </Button>
            </div>
          ) : midi.devices.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground mb-3">
                Available devices:
              </p>
              {midi.devices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <Piano className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{device.name || 'Unknown Device'}</span>
                  </div>
                  <Button onClick={() => midi.connect(device)} size="sm">
                    Connect
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <WifiOff className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">No MIDI devices detected.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Connect a MIDI keyboard and refresh the page.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audio Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Music className="h-5 w-5" />
            Audio Settings
          </CardTitle>
          <CardDescription>
            Configure audio playback options.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="reference-tone" className="cursor-pointer">
              Reference Tone
            </Label>
            <Switch
              id="reference-tone"
              checked={settings.referenceTone}
              onCheckedChange={(v) => update('referenceTone', v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Practice Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5" />
            Practice Settings
          </CardTitle>
          <CardDescription>
            Adjust chord recognition timing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="chord-window">Chord Window</Label>
              <span className="text-sm text-muted-foreground font-mono">
                {settings.chordWindowMs}ms
              </span>
            </div>
            <Slider
              id="chord-window"
              min={50}
              max={500}
              step={10}
              value={[settings.chordWindowMs]}
              onValueChange={([v]) => update('chordWindowMs', v)}
            />
            <p className="text-xs text-muted-foreground">
              Time window for recognizing simultaneous notes as a chord. Lower values require more
              precise timing to play chords correctly.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
