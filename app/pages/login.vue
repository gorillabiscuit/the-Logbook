<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

const supabase = useSupabaseClient()
const email = ref('')
const loading = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

const submit = async () => {
  error.value = null
  loading.value = true

  const { error: authError } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: {
      emailRedirectTo: `${window.location.origin}/confirm`,
    },
  })

  loading.value = false

  if (authError) {
    error.value = authError.message
    return
  }

  sent.value = true
}
</script>

<template>
  <div>
    <div v-if="!sent">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-1">Sign in</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
        We'll send a magic link to your email address.
      </p>

      <UForm @submit="submit" class="space-y-4">
        <UFormField label="Email address" name="email">
          <UInput
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
            class="w-full"
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          :description="error"
        />

        <UButton
          type="submit"
          label="Send magic link"
          :loading="loading"
          class="w-full"
          justify="center"
        />
      </UForm>
    </div>

    <div v-else class="text-center py-4">
      <UIcon name="i-heroicons-envelope-open" class="w-12 h-12 text-primary-500 mx-auto mb-4" />
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Check your email</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        We sent a magic link to <strong>{{ email }}</strong>. Click it to sign in.
      </p>
      <UButton
        label="Use a different email"
        variant="ghost"
        size="sm"
        class="mt-4"
        @click="sent = false"
      />
    </div>
  </div>
</template>
