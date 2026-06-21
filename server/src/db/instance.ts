import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 进程级单例 db。使用绝对路径避免 CWD 相关问题。
// 默认指向 server/db.sqlite（项目仓库中的持久化文件）。
// 测试用 createDb(':memory:') 自行构造，不走这里。
export const db = createDb(
  process.env.PIANOSCORE_DB ?? resolve(__dirname, '../../db.sqlite'),
)
