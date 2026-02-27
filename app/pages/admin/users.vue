<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { isAdmin } = useAuth()
if (!isAdmin.value) {
  await navigateTo('/')
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">User Management</h1>
    <UCard>
      <div class="text-center py-16 text-gray-400 dark:text-gray-500">
        <UIcon name="i-heroicons-users" class="w-10 h-10 mx-auto mb-3" />
        <p class="text-sm">User management is coming in Phase 1 (next iteration).</p>
      </div>
    </UCard>
  </div>
</template>
