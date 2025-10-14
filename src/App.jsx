import { useState, useEffect, useRef } from 'react'
import { useAbly } from './AblyProvider'
import './App.css'

function App() {
  const [messages, setMessages] = useState([])
  const [messageText, setMessageText] = useState('')
  const [username, setUsername] = useState('')
  const [isUsernameSet, setIsUsernameSet] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState([])
  const [typingUsers, setTypingUsers] = useState(new Set())
  const [isConnected, setIsConnected] = useState(false)
  const ably = useAbly()
  const messagesEndRef = useRef(null)
  const typingTimeoutRef = useRef(null)

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Generate a color for each user based on their username
  const getUserColor = (name) => {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2']
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  // Get initials from username
  const getInitials = (name) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  useEffect(() => {
    // Only setup Ably if client is available or username is not set
    if (!ably || !isUsernameSet) {
      if (!ably) {
        console.log('Ably client not available - real-time chat disabled')
      }
      setIsConnected(false)
      return
    }

    console.log('Current Ably connection state:', ably.connection.state)

    // Update connection state based on current state
    const updateConnectionState = () => {
      const state = ably.connection.state
      const connected = state === 'connected'
      console.log('Connection state changed to:', state, '(connected:', connected, ')')
      setIsConnected(connected)
    }

    // Check initial state
    updateConnectionState()

    // Monitor all connection state changes
    ably.connection.on('connected', updateConnectionState)
    ably.connection.on('connecting', updateConnectionState)
    ably.connection.on('disconnected', updateConnectionState)
    ably.connection.on('suspended', updateConnectionState)
    ably.connection.on('closed', updateConnectionState)
    ably.connection.on('failed', (error) => {
      console.error('Ably connection failed:', error)
      updateConnectionState()
    })

    // Get the chat channel
    const channel = ably.channels.get('chat')

    // Subscribe to chat messages
    const messageHandler = (message) => {
      if (message.name === 'chat-message') {
        // Only add messages from other users (avoid duplicates)
        if (message.data.username !== username) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              id: message.id,
              text: message.data.text,
              username: message.data.username,
              timestamp: message.timestamp,
              clientId: message.clientId
            }
          ])
          console.log('📨 Received message from Ably:', message.data)
        }
      }
    }

    // Handle typing indicators
    const typingHandler = (message) => {
      if (message.name === 'typing' && message.data.username !== username) {
        setTypingUsers((prev) => {
          const newSet = new Set(prev)
          if (message.data.isTyping) {
            newSet.add(message.data.username)
          } else {
            newSet.delete(message.data.username)
          }
          return newSet
        })

        // Auto-remove typing indicator after 3 seconds
        if (message.data.isTyping) {
          setTimeout(() => {
            setTypingUsers((prev) => {
              const newSet = new Set(prev)
              newSet.delete(message.data.username)
              return newSet
            })
          }, 3000)
        }
      }
    }

    channel.subscribe('chat-message', messageHandler)
    channel.subscribe('typing', typingHandler)

    // Setup presence for online users
    channel.presence.enter({ username }).then(() => {
      console.log('👋 Entered presence as:', username)
    }).catch((err) => {
      console.error('Failed to enter presence:', err)
    })

    channel.presence.subscribe('enter', (member) => {
      console.log('👤 User joined:', member.data.username)
      setOnlineUsers((prev) => {
        if (!prev.includes(member.data.username)) {
          return [...prev, member.data.username]
        }
        return prev
      })
    })

    channel.presence.subscribe('leave', (member) => {
      console.log('👋 User left:', member.data.username)
      setOnlineUsers((prev) => prev.filter(u => u !== member.data.username))
    })

    // Get initial presence
    channel.presence.get((err, members) => {
      if (!err) {
        const users = members.map(m => m.data.username)
        console.log('👥 Initial online users:', users)
        setOnlineUsers(users)
      } else {
        console.error('Failed to get presence:', err)
      }
    })

    // Cleanup subscription on unmount
    return () => {
      channel.presence.leave()
      channel.unsubscribe('chat-message', messageHandler)
      channel.unsubscribe('typing', typingHandler)
      ably.connection.off(updateConnectionState)
    }
  }, [ably, username, isUsernameSet])

  const handleUsernameSubmit = (e) => {
    e.preventDefault()
    if (username.trim()) {
      setIsUsernameSet(true)
    }
  }

  const handleInputChange = (e) => {
    setMessageText(e.target.value)

    // Send typing indicator
    if (ably) {
      const channel = ably.channels.get('chat')

      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }

      // Publish typing start
      channel.publish('typing', { username, isTyping: true })

      // Set timeout to stop typing indicator
      typingTimeoutRef.current = setTimeout(() => {
        channel.publish('typing', { username, isTyping: false })
      }, 1000)
    }
  }

  const handleSendMessage = async (e) => {
    e.preventDefault()

    if (!messageText.trim()) return

    const messageId = `${Date.now()}-${Math.random()}`
    const message = {
      text: messageText,
      username: username,
      timestamp: Date.now()
    }

    // Add message to local state immediately for instant feedback
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        id: messageId,
        text: message.text,
        username: message.username,
        timestamp: message.timestamp,
        clientId: ably?.auth?.clientId
      }
    ])

    // Publish to Ably for other users
    if (ably && isConnected) {
      try {
        const channel = ably.channels.get('chat')
        await channel.publish('typing', { username, isTyping: false })
        await channel.publish('chat-message', message)
        console.log('✅ Message published to Ably:', message)
      } catch (error) {
        console.error('❌ Failed to publish message:', error)
      }
    } else {
      console.warn('⚠️ Ably not connected - message only visible locally')
    }

    setMessageText('')

    // Clear typing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
  }

  if (!isUsernameSet) {
    return (
      <div className="username-container">
        <h1>Real-Time Chat with Ably</h1>
        <form onSubmit={handleUsernameSubmit} className="username-form">
          <input
            type="text"
            placeholder="Enter your username..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="username-input"
            autoFocus
          />
          <button type="submit" className="join-button">
            Join Chat
          </button>
        </form>
        {!ably && (
          <p className="warning">
            Warning: Ably not configured. Messages will only be visible in this tab.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="chat-wrapper">
      {/* Online Users Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h3>Online ({onlineUsers.length})</h3>
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot"></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
        <div className="online-users">
          {onlineUsers.map((user, index) => (
            <div key={index} className="online-user">
              <div
                className="user-avatar"
                style={{ backgroundColor: getUserColor(user) }}
              >
                {getInitials(user)}
              </div>
              <span className="user-name">{user}</span>
              {user === username && <span className="you-badge">(You)</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="chat-container">
        <div className="chat-header">
          <div>
            <h1>Real-Time Chat</h1>
            <p className="username-display">Logged in as: <strong>{username}</strong></p>
          </div>
        </div>

        <div className="messages-container">
          {messages.length === 0 ? (
            <p className="no-messages">No messages yet. Start the conversation!</p>
          ) : (
            messages.map((msg, index) => {
              const showAvatar = index === 0 || messages[index - 1].username !== msg.username
              return (
                <div
                  key={msg.id}
                  className={`message ${msg.username === username ? 'own-message' : 'other-message'}`}
                >
                  {showAvatar && msg.username !== username && (
                    <div
                      className="message-avatar"
                      style={{ backgroundColor: getUserColor(msg.username) }}
                    >
                      {getInitials(msg.username)}
                    </div>
                  )}
                  <div className="message-content">
                    {showAvatar && (
                      <div className="message-header">
                        <span className="message-username">{msg.username}</span>
                        <span className="message-time">
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    )}
                    <div className="message-text">{msg.text}</div>
                  </div>
                </div>
              )
            })
          )}

          {/* Typing Indicator */}
          {typingUsers.size > 0 && (
            <div className="typing-indicator">
              <div className="typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span className="typing-text">
                {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} className="message-form">
          <input
            type="text"
            placeholder="Type your message..."
            value={messageText}
            onChange={handleInputChange}
            className="message-input"
          />
          <button type="submit" className="send-button" disabled={!messageText.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

export default App
