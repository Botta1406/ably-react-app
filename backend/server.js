import express from 'express'
import cors from 'cors'
import Ably from 'ably'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Initialize Ably with server-side API key
const ably = new Ably.Realtime({
  key: process.env.VITE_ABLY_API_KEY
})

// Log connection status
ably.connection.on('connected', () => {
  console.log('✅ Backend connected to Ably')
})

ably.connection.on('failed', (error) => {
  console.error('❌ Backend Ably connection failed:', error)
})

// Get the chat channel
const chatChannel = ably.channels.get('chat')

// Store active typing users with timestamps
const typingUsers = new Map()
const TYPING_TIMEOUT = 3000 // 3 seconds

// Clean up expired typing indicators
setInterval(() => {
  const now = Date.now()
  for (const [username, timestamp] of typingUsers.entries()) {
    if (now - timestamp > TYPING_TIMEOUT) {
      typingUsers.delete(username)
      // Broadcast typing stopped
      chatChannel.publish('typing', {
        username,
        isTyping: false
      }).catch(err => console.error('Failed to publish typing stopped:', err))
    }
  }
}, 5000)

// Endpoint to handle typing indicators
app.post('/api/typing', async (req, res) => {
  try {
    const { username, isTyping } = req.body

    if (!username) {
      return res.status(400).json({ error: 'Username is required' })
    }

    if (typeof isTyping !== 'boolean') {
      return res.status(400).json({ error: 'isTyping must be a boolean' })
    }

    // Update typing users map
    if (isTyping) {
      typingUsers.set(username, Date.now())
    } else {
      typingUsers.delete(username)
    }

    // Publish typing indicator to Ably
    await chatChannel.publish('typing', {
      username,
      isTyping,
      timestamp: Date.now()
    })

    console.log(`📝 ${username} is ${isTyping ? 'typing' : 'not typing'}`)

    res.json({
      success: true,
      message: 'Typing indicator sent',
      activeTypingUsers: Array.from(typingUsers.keys())
    })
  } catch (error) {
    console.error('Error handling typing indicator:', error)
    res.status(500).json({ error: 'Failed to send typing indicator' })
  }
})

// Endpoint to get currently typing users
app.get('/api/typing', (req, res) => {
  try {
    const activeUsers = Array.from(typingUsers.keys())
    res.json({ typingUsers: activeUsers })
  } catch (error) {
    console.error('Error getting typing users:', error)
    res.status(500).json({ error: 'Failed to get typing users' })
  }
})

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ablyConnectionState: ably.connection.state,
    timestamp: Date.now()
  })
})

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`)
  console.log(`📡 Ably connection state: ${ably.connection.state}`)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down server...')
  ably.close()
  process.exit(0)
})