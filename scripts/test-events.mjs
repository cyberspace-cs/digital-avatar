// 事件注入测试脚本：从阿泰向小美发送 hug / 短句，用于本地验证接收端表现
// 用法：node scripts/test-events.mjs [action]
import { io } from 'socket.io-client'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = new DatabaseSync(path.join(__dirname, '..', 'server', 'digital_avatar.db'))
const users = db.prepare('SELECT * FROM users').all()
const a = users.find((u) => u.name.startsWith('阿泰'))
const b = users.find((u) => u.name.startsWith('小美'))
if (!a || !b) {
  console.error('users not found:', users.map((u) => u.name))
  process.exit(1)
}

const action = process.argv[2] || 'hug'
const socket = io('http://localhost:8090', { query: { userId: a.id } })

socket.on('connect', () => {
  console.log(`connected as ${a.name}, sending ${action} to ${b.name}`)
  socket.emit('interaction', { senderId: a.id, receiverId: b.id, action, message: action === 'hug' ? null : '早点睡哦' })
  setTimeout(() => {
    console.log('done')
    socket.disconnect()
    process.exit(0)
  }, 2000)
})
socket.on('connect_error', (e) => {
  console.error('connect_error', e.message)
  process.exit(1)
})
