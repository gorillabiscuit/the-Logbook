<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const {
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
} = useChat()

const inputMessage = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const showSidebar = ref(false)

onMounted(() => {
  fetchConversations()
})

async function handleSend() {
  const msg = inputMessage.value.trim()
  if (!msg || sending.value) return
  inputMessage.value = ''
  await sendMessage(msg)
  scrollToBottom()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

async function selectConversation(id: string) {
  await loadConversation(id)
  showSidebar.value = false
  scrollToBottom()
}

function handleNewChat() {
  startNewConversation()
  showSidebar.value = false
}

async function handleDelete(id: string) {
  await deleteConversation(id)
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

// Auto-scroll when messages change
watch(messages, () => scrollToBottom(), { deep: true })

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Johannesburg',
  })
}
</script>

<template>
  <div class="-mx-4 sm:-mx-6 lg:-mx-8 -my-6 flex h-[calc(100vh-48px)] lg:h-screen">
    <!-- Conversation sidebar -->
    <div
      class="fixed inset-y-0 right-0 z-40 w-72 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 transform transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 flex flex-col"
      :class="showSidebar ? 'translate-x-0' : 'translate-x-full'"
    >
      <!-- Sidebar header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <span class="text-sm font-semibold text-gray-900 dark:text-white">Conversations</span>
        <UButton
          icon="i-heroicons-plus"
          variant="ghost"
          size="xs"
          @click="handleNewChat"
        />
      </div>

      <!-- Conversation list -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="loading && conversations.length === 0" class="p-4 text-center text-sm text-gray-400">
          Loading...
        </div>
        <div v-else-if="conversations.length === 0" class="p-4 text-center text-sm text-gray-400">
          No conversations yet
        </div>
        <button
          v-for="conv in conversations"
          :key="conv.id"
          class="w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
          :class="currentConversationId === conv.id ? 'bg-primary-50 dark:bg-primary-950' : ''"
          @click="selectConversation(conv.id)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-gray-900 dark:text-white truncate">
                {{ conv.title || 'New conversation' }}
              </div>
              <div class="text-xs text-gray-400 mt-0.5">
                {{ formatDate(conv.updated_at) }}
              </div>
            </div>
            <UButton
              icon="i-heroicons-trash"
              variant="ghost"
              size="xs"
              color="error"
              class="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              @click.stop="handleDelete(conv.id)"
            />
          </div>
        </button>
      </div>
    </div>

    <!-- Mobile sidebar overlay -->
    <div
      v-if="showSidebar"
      class="fixed inset-0 z-30 bg-black/50 lg:hidden"
      @click="showSidebar = false"
    />

    <!-- Main chat area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Chat header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div class="flex items-center gap-2">
          <UIcon name="i-heroicons-chat-bubble-left-right" class="w-5 h-5 text-primary-500" />
          <h1 class="text-lg font-semibold text-gray-900 dark:text-white">AI Chat</h1>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            icon="i-heroicons-plus"
            label="New"
            variant="soft"
            size="sm"
            @click="handleNewChat"
          />
          <UButton
            icon="i-heroicons-clock"
            variant="ghost"
            size="sm"
            class="lg:hidden"
            @click="showSidebar = !showSidebar"
          />
        </div>
      </div>

      <!-- Messages area -->
      <div
        ref="messagesContainer"
        class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950"
      >
        <!-- Empty state -->
        <div
          v-if="messages.length === 0 && !loading"
          class="flex flex-col items-center justify-center h-full text-center px-4"
        >
          <div class="w-16 h-16 bg-primary-100 dark:bg-primary-900 rounded-2xl flex items-center justify-center mb-4">
            <UIcon name="i-heroicons-chat-bubble-left-right" class="w-8 h-8 text-primary-600 dark:text-primary-400" />
          </div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            Ask about the building
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 max-w-md mb-6">
            Query the document archive using natural language. The AI will search through uploaded documents and provide answers with source citations.
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            <UButton
              v-for="suggestion in [
                'What are the current levy amounts?',
                'Summarise the last AGM minutes',
                'What maintenance issues are outstanding?',
                'What does the constitution say about voting?',
              ]"
              :key="suggestion"
              :label="suggestion"
              variant="outline"
              size="sm"
              class="text-xs"
              @click="inputMessage = suggestion"
            />
          </div>
        </div>

        <!-- Messages -->
        <div v-else class="max-w-3xl mx-auto px-4 py-4 space-y-4">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="flex gap-3"
            :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <!-- Assistant avatar -->
            <div
              v-if="msg.role === 'assistant'"
              class="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center flex-shrink-0 mt-1"
            >
              <UIcon name="i-heroicons-sparkles" class="w-4 h-4 text-primary-600 dark:text-primary-400" />
            </div>

            <!-- Message bubble -->
            <div
              class="max-w-[80%] rounded-2xl px-4 py-3"
              :class="msg.role === 'user'
                ? 'bg-primary-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'"
            >
              <!-- Message content -->
              <div class="text-sm whitespace-pre-wrap break-words" v-text="msg.content" />

              <!-- Source citations (assistant only) -->
              <div
                v-if="msg.role === 'assistant' && msg.source_chunks?.length"
                class="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700"
              >
                <div class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Sources</div>
                <div class="flex flex-wrap gap-1.5">
                  <NuxtLink
                    v-for="(source, idx) in msg.source_chunks"
                    :key="source.chunkId"
                    :to="`/documents/${source.documentId}`"
                    class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900 transition-colors"
                  >
                    <UIcon name="i-heroicons-document-text" class="w-3 h-3" />
                    {{ source.documentTitle.length > 30 ? source.documentTitle.slice(0, 27) + '...' : source.documentTitle }}
                  </NuxtLink>
                </div>
              </div>

              <!-- Timestamp -->
              <div
                class="text-[10px] mt-1.5 opacity-60"
                :class="msg.role === 'user' ? 'text-right' : ''"
              >
                {{ formatTime(msg.created_at) }}
              </div>
            </div>
          </div>

          <!-- Typing indicator -->
          <div v-if="sending" class="flex gap-3 justify-start">
            <div class="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-heroicons-sparkles" class="w-4 h-4 text-primary-600 dark:text-primary-400 animate-pulse" />
            </div>
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3">
              <div class="flex items-center gap-1.5">
                <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0ms" />
                <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 150ms" />
                <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 300ms" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error display -->
      <div v-if="error" class="px-4 py-2 bg-red-50 dark:bg-red-950 border-t border-red-200 dark:border-red-800">
        <p class="text-xs text-red-600 dark:text-red-400">{{ error }}</p>
      </div>

      <!-- Input area -->
      <div class="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
        <div class="max-w-3xl mx-auto flex items-end gap-3">
          <textarea
            v-model="inputMessage"
            rows="1"
            placeholder="Ask a question about the building..."
            class="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            :disabled="sending"
            @keydown="handleKeydown"
          />
          <UButton
            icon="i-heroicons-paper-airplane"
            size="md"
            :loading="sending"
            :disabled="!inputMessage.trim() || sending"
            @click="handleSend"
          />
        </div>
        <p class="max-w-3xl mx-auto text-[10px] text-gray-400 dark:text-gray-500 mt-1.5 text-center">
          AI responses are based on uploaded documents and may not be complete. Always verify important information.
        </p>
      </div>
    </div>
  </div>
</template>
