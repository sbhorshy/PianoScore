import { useMIDI } from '../hooks/useMIDI'

export function Settings() {
  const { isSupported, isConnected, devices, selectedDevice, connect, disconnect } = useMIDI()

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">设置</h2>

      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        {/* MIDI Settings */}
        <div>
          <h3 className="text-lg font-semibold mb-4">MIDI 设备</h3>
          
          {!isSupported && (
            <p className="text-red-600">您的浏览器不支持 Web MIDI API</p>
          )}

          {isSupported && (
            <>
              {isConnected ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-green-600 font-medium">已连接</p>
                    <p className="text-gray-600">{selectedDevice?.name}</p>
                  </div>
                  <button
                    onClick={disconnect}
                    className="px-4 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200"
                  >
                    断开
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-gray-600 mb-3">选择 MIDI 设备:</p>
                  <div className="space-y-2">
                    {devices.length === 0 ? (
                      <p className="text-gray-500">未检测到 MIDI 设备</p>
                    ) : (
                      devices.map((device) => (
                        <button
                          key={device.id}
                          onClick={() => connect(device)}
                          className="w-full text-left px-4 py-3 border rounded-lg hover:bg-blue-50 hover:border-blue-300"
                        >
                          {device.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Audio Settings */}
        <div>
          <h3 className="text-lg font-semibold mb-4">音频设置</h3>
          <div className="space-y-3">
            <label className="flex items-center">
              <input type="checkbox" className="mr-2" defaultChecked />
              启用节拍器
            </label>
            <label className="flex items-center">
              <input type="checkbox" className="mr-2" defaultChecked />
              播放参考音
            </label>
          </div>
        </div>

        {/* Practice Settings */}
        <div>
          <h3 className="text-lg font-semibold mb-4">练习设置</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-600 mb-1">时间容差 (秒)</label>
              <input
                type="range"
                min="0.1"
                max="0.5"
                step="0.05"
                defaultValue="0.2"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
