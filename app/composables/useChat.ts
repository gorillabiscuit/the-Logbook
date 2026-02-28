interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  source_chunks?: Array<{
    chunkId: string
    documentId: string
    documentTitle: string
    similarity: number
  }>
  created_at: string
}

interface Conversation {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

export function useChat() {
  const supabase = useSupabaseClient()

  const conversations = ref<Conversation[]>([])
  const currentConversationId = ref<string | null>(null)
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const sending = ref(false)
  const error = ref<string | null>(null)

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    return { Authorization: `Bearer ${session.access_token}` }
  }

  async function fetchConversations() {
    loading.value = true
    error.value = null
    try {
      const headers = await getAuthHeaders()
      const data = await $fetch<Conversation[]>('/api/chat/conversations', { headers })
      conversations.value = data
    } catch (err: any) {
      error.value = err.message
    } finally {
      loading.value = false
    }
  }

  async function loadConversation(conversationId: string) {
    loading.value = true
    error.value = null
    try {
      const headers = await getAuthHeaders()
      const data = await $fetch<{ conversation: any; messages: ChatMessage[] }>(
        `/api/chat/${conversationId}`,
        { headers }
      )
      currentConversationId.value = conversationId
      messages.value = data.messages
    } catch (err: any) {
      error.value = err.message
    } finally {
      loading.value = false
    }
  }

  async function sendMessage(message: string) {
    sending.value = true
    error.value = null

    // Optimistically add the user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    }
    messages.value.push(tempUserMsg)

    try {
      const headers = await getAuthHeaders()
      const data = await $fetch<{
        conversationId: string
        userMessage: ChatMessage
        assistantMessage: ChatMessage
      }>('/api/chat/query', {
        method: 'POST',
        headers,
        body: {
          conversationId: currentConversationId.value,
          message,
        },
      })

      // Set conversation ID (important for first message)
      currentConversationId.value = data.conversationId

      // Replace temp user message with real one
      const tempIdx = messages.value.findIndex(m => m.id === tempUserMsg.id)
      if (tempIdx >= 0) {
        messages.value[tempIdx] = data.userMessage
      }

      // Add assistant response
      messages.value.push(data.assistantMessage)

      // Refresh conversations list to update sidebar
      await fetchConversations()
    } catch (err: any) {
      // Remove the optimistic message on error
      messages.value = messages.value.filter(m => m.id !== tempUserMsg.id)
      error.value = err?.data?.message || err.message || 'Failed to send message'
    } finally {
      sending.value = false
    }
  }

  function startNewConversation() {
    currentConversationId.value = null
    messages.value = []
    error.value = null
  }

  async function deleteConversation(conversationId: string) {
    try {
      const headers = await getAuthHeaders()
      await $fetch(`/api/chat/${conversationId}`, { method: 'DELETE', headers })
      conversations.value = conversations.value.filter(c => c.id !== conversationId)
      if (currentConversationId.value === conversationId) {
        startNewConversation()
      }
    } catch (err: any) {
      error.value = err.message
    }
  }

  return {
    conversations,
    currentConversationId,
    messages,
    loading,
    sending,
    error,
    fetchConversations,
    loadConversation,
    sendMessage,
    startNewConversation,
    deleteConversation,
  }
}
