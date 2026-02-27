import { useState } from 'react'

export function AITranscribe() {
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
    }
  }

  const handleUpload = async () => {
    if (!file) return

    setIsUploading(true)
    
    // TODO: Upload to backend API
    // const formData = new FormData()
    // formData.append('file', file)
    // const response = await fetch('/api/ai/transcribe', {
    //   method: 'POST',
    //   body: formData,
    // })
    // const data = await response.json()
    
    // Mock result
    setTimeout(() => {
      setResult('识别完成！生成 MusicXML 文件...')
      setIsUploading(false)
    }, 2000)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">AI 识谱</h2>
      
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 mb-4">
          上传 PDF 或图片格式的乐谱，AI 将自动识别并转换为可编辑的 MusicXML 格式。
        </p>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer text-blue-600 hover:text-blue-800"
          >
            {file ? file.name : '点击选择文件'}
          </label>
        </div>

        {file && (
          <button
            onClick={handleUpload}
            disabled={isUploading}
            className="mt-4 w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            {isUploading ? '识别中...' : '开始识别'}
          </button>
        )}

        {result && (
          <div className="mt-4 p-4 bg-green-50 text-green-800 rounded">
            {result}
          </div>
        )}
      </div>
    </div>
  )
}
