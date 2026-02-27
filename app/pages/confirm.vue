<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

const { fetchProfile, hasConsented } = useProfile()
const user = useSupabaseUser()

// Wait for auth state to resolve, then check consent
watchEffect(async () => {
  if (!user.value) return

  await fetchProfile()

  if (!hasConsented.value) {
    await navigateTo('/consent')
  } else {
    await navigateTo('/')
  }
})
</script>

<template>
  <div class="text-center py-8">
    <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 text-primary-500 mx-auto mb-3 animate-spin" />
    <p class="text-sm text-gray-500 dark:text-gray-400">Signing you in…</p>
  </div>
</template>
