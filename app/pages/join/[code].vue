<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

const route = useRoute()
const code = route.params.code as string

const loading = ref(true)
const submitting = ref(false)
const invite = ref<{ code: string; role: string; remaining_uses: number | null; expires_at: string | null } | null>(null)
const validationError = ref<string | null>(null)
const submitError = ref<string | null>(null)
const success = ref(false)

const form = reactive({
  email: '',
  full_name: '',
  unit_number: '',
})

// Validate the invite code on load
onMounted(async () => {
  try {
    invite.value = await $fetch(`/api/join/${code}`)
  } catch (e: any) {
    validationError.value = e.data?.message || 'Invalid invite code'
  } finally {
    loading.value = false
  }
})

const submit = async () => {
  submitError.value = null
  submitting.value = true

  try {
    await $fetch(`/api/join/${code}`, {
      method: 'POST',
      body: {
        email: form.email,
        full_name: form.full_name,
        unit_number: form.unit_number,
      },
    })
    success.value = true
  } catch (e: any) {
    submitError.value = e.data?.message || 'Failed to claim invite'
  } finally {
    submitting.value = false
  }
}

const roleLabel = (role: string) => role.replace(/_/g, ' ')
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="text-center py-8">
      <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 text-primary-500 mx-auto mb-3 animate-spin" />
      <p class="text-sm text-gray-500 dark:text-gray-400">Validating invite…</p>
    </div>

    <!-- Invalid code -->
    <div v-else-if="validationError" class="text-center py-4">
      <UIcon name="i-heroicons-x-circle" class="w-12 h-12 text-red-500 mx-auto mb-4" />
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Invalid Invite</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">{{ validationError }}</p>
      <UButton label="Go to login" to="/login" variant="ghost" size="sm" />
    </div>

    <!-- Success -->
    <div v-else-if="success" class="text-center py-4">
      <UIcon name="i-heroicons-envelope-open" class="w-12 h-12 text-primary-500 mx-auto mb-4" />
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Check your email</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        We sent a magic link to <strong>{{ form.email }}</strong>. Click it to sign in.
      </p>
    </div>

    <!-- Claim form -->
    <div v-else-if="invite">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-1">Join The Logbook</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
        You've been invited to join as <UBadge color="primary" variant="subtle" size="xs">{{ roleLabel(invite.role) }}</UBadge>
      </p>

      <form @submit.prevent="submit" class="space-y-4">
        <UFormField label="Email address" required>
          <UInput
            v-model="form.email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Full name">
          <UInput
            v-model="form.full_name"
            placeholder="Your full name"
            autocomplete="name"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Unit number">
          <UInput
            v-model="form.unit_number"
            placeholder="e.g. 1201"
            class="w-full"
          />
        </UFormField>

        <UAlert
          v-if="submitError"
          color="error"
          variant="soft"
          :description="submitError"
        />

        <UButton
          type="submit"
          label="Get magic link"
          :loading="submitting"
          class="w-full"
          justify="center"
        />
      </form>

      <p v-if="invite.remaining_uses !== null" class="text-xs text-center text-gray-400 mt-3">
        {{ invite.remaining_uses }} invite{{ invite.remaining_uses === 1 ? '' : 's' }} remaining
      </p>
    </div>
  </div>
</template>
