import { createContext, useContext, useEffect, useState } from 'react'
import { Realtime } from 'ably'

const AblyContext = createContext(null)

export function useAbly() {
  const context = useContext(AblyContext)
  return context
}

export default function AblyProvider({ children }) {
  const [client] = useState(() => {
    const apiKey = import.meta.env.VITE_ABLY_API_KEY

    // Only create client if we have a valid API key
    if (!apiKey || apiKey === 'your_ably_api_key_here') {
      console.warn('Ably API key not configured. Please add your key to .env file')
      return null
    }

    try {
      const ablyClient = new Realtime({
        key: apiKey,
        clientId: `user-${Math.random().toString(36).substring(7)}`,
        // Auto-connect
        autoConnect: true,
        // Enable echoing of own messages
        echoMessages: false,
        // Close connection on page unload but not on component remount
        closeOnUnload: true
      })

      // Log connection state changes
      ablyClient.connection.on('connected', () => {
        console.log('✅ Ably connected successfully')
      })

      ablyClient.connection.on('failed', (error) => {
        console.error('❌ Ably connection failed:', error)
      })

      ablyClient.connection.on('disconnected', () => {
        console.warn('⚠️ Ably disconnected')
      })

      return ablyClient
    } catch (error) {
      console.error('Failed to initialize Ably client:', error)
      return null
    }
  })

  // Don't close connection on unmount - let it persist
  // Only close when the page actually unloads (handled by closeOnUnload: true)
  // This prevents React Strict Mode from closing the connection during development

  return (
    <AblyContext.Provider value={client}>
      {children}
    </AblyContext.Provider>
  )
}