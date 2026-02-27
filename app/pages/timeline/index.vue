<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">Timeline</h1>
    <UCard>
      <div class="text-center py-16 text-gray-400 dark:text-gray-500">
        <UIcon name="i-heroicons-calendar-days" class="w-10 h-10 mx-auto mb-3" />
        <p class="text-sm">Scheme history timeline is coming in Phase 4.</p>
      </div>
    </UCard>
  </div>
</template>
