<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Issues</h1>
      <UButton label="Report issue" icon="i-heroicons-plus" to="/issues/new" />
    </div>
    <UCard>
      <div class="text-center py-16 text-gray-400 dark:text-gray-500">
        <UIcon name="i-heroicons-exclamation-triangle" class="w-10 h-10 mx-auto mb-3" />
        <p class="text-sm">Issue tracking is coming in Phase 4.</p>
      </div>
    </UCard>
  </div>
</template>
