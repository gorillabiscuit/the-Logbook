<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">AI Chat</h1>
    <p class="text-gray-500 dark:text-gray-400 text-sm mb-6">Ask questions about the building's history and documents.</p>
    <UCard>
      <div class="text-center py-16 text-gray-400 dark:text-gray-500">
        <UIcon name="i-heroicons-chat-bubble-left-right" class="w-10 h-10 mx-auto mb-3" />
        <p class="text-sm">AI chat is coming in Phase 3.</p>
      </div>
    </UCard>
  </div>
</template>
