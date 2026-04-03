<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

const supabase = useSupabaseClient()
const email = ref('')
const loading = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)
const errorTone = ref<'error' | 'warning'>('error')
const cooldownSeconds = ref(0)

let cooldownTimer: ReturnType<typeof setInterval> | null = null

function startCooldown(seconds: number) {
  cooldownSeconds.value = seconds
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    cooldownSeconds.value -= 1
    if (cooldownSeconds.value <= 0) {
      if (cooldownTimer) clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})

function formatCooldown(s: number) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${r}s`
}

function mapAuthError(authError: { message: string; status?: number }) {
  const m = authError.message.toLowerCase()
  if (m.includes('rate limit') || m.includes('too many')) {
    return {
      tone: 'warning' as const,
      text: 'Too many sign-in emails were sent from this project recently (a Supabase safety limit). Wait 30–60 minutes, check spam for an earlier link, or ask a trustee to help. For fewer limits, configure custom SMTP under Authentication in the Supabase dashboard.',
    }
  }
  if (
    authError.message.includes('Signups not allowed')
    || authError.message.includes('not allowed')
    || authError.status === 403
  ) {
    return {
      tone: 'error' as const,
      text: 'This email isn\'t registered yet. Contact your building admin or use an invite link.',
    }
  }
  return { tone: 'error' as const, text: authError.message }
}

const submitDisabled = computed(() => cooldownSeconds.value > 0)

const submitLabel = computed(() => {
  if (cooldownSeconds.value > 0) {
    return `Wait ${formatCooldown(cooldownSeconds.value)}`
  }
  return 'Send magic link'
})

const submit = async () => {
  if (cooldownSeconds.value > 0) return

  error.value = null
  errorTone.value = 'error'
  loading.value = true

  const { error: authError } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/confirm`,
    },
  })

  loading.value = false

  if (authError) {
    const mapped = mapAuthError(authError)
    error.value = mapped.text
    errorTone.value = mapped.tone
    if (mapped.tone === 'warning') {
      startCooldown(120)
    }
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
          :color="errorTone"
          variant="soft"
          :description="error"
        />

        <UButton
          type="submit"
          :label="submitLabel"
          :loading="loading"
          :disabled="submitDisabled"
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
      <p class="text-xs text-gray-400 dark:text-gray-500 mt-3 max-w-sm mx-auto">
        No email? Check spam. If you request again too often, sign-in may pause for a while.
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
