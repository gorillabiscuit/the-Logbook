<script setup lang="ts">
definePageMeta({
  layout: 'default',
})

const { isAdmin, profile } = useAuth()
const supabase = useSupabaseClient()

// Redirect non-admins
if (!isAdmin.value) {
  navigateTo('/')
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

const allRoleOptions = [
  { label: 'Owner', value: 'owner' },
  { label: 'Tenant', value: 'tenant' },
  { label: 'Trustee', value: 'trustee' },
  { label: 'Lawyer', value: 'lawyer' },
  { label: 'Building Manager', value: 'building_manager' },
  { label: 'Management Co', value: 'management_co' },
  { label: 'Super Admin', value: 'super_admin' },
]

// Only super_admin can invite super_admins
const roleOptions = computed(() =>
  profile.value?.role === 'super_admin'
    ? allRoleOptions
    : allRoleOptions.filter(r => r.value !== 'super_admin')
)

// ============================================================
// Section A: Invite by Email
// ============================================================
const singleForm = reactive({
  email: '',
  full_name: '',
  unit_number: '',
  role: 'owner',
})
const singleLoading = ref(false)
const singleResult = ref<{ success: boolean; message: string } | null>(null)

const sendSingleInvite = async () => {
  singleLoading.value = true
  singleResult.value = null
  try {
    await $fetch('/api/admin/invite', {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: {
        email: singleForm.email,
        role: singleForm.role,
        full_name: singleForm.full_name,
        unit_number: singleForm.unit_number,
      },
    })
    singleResult.value = { success: true, message: `Invite sent to ${singleForm.email}` }
    singleForm.email = ''
    singleForm.full_name = ''
    singleForm.unit_number = ''
  } catch (e: any) {
    singleResult.value = { success: false, message: e.data?.message || 'Failed to send invite' }
  } finally {
    singleLoading.value = false
  }
}

// Bulk invite
const bulkEmails = ref('')
const bulkRole = ref('owner')
const bulkSendEmail = ref(true)
const bulkLoading = ref(false)
const bulkResults = ref<{ total: number; sent: number; failed: number; details: { email: string; success: boolean; error?: string }[] } | null>(null)

const sendBulkInvites = async () => {
  const emails = bulkEmails.value
    .split('\n')
    .map(e => e.trim())
    .filter(e => e.length > 0)

  if (emails.length === 0) return

  bulkLoading.value = true
  bulkResults.value = null

  try {
    const res = await $fetch<{ summary: { total: number; sent: number; failed: number }; results: { email: string; success: boolean; error?: string }[] }>('/api/admin/invite-bulk', {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: {
        emails,
        role: bulkRole.value,
        sendEmail: bulkSendEmail.value,
      },
    })
    bulkResults.value = { ...res.summary, details: res.results }
    if (res.summary.failed === 0) bulkEmails.value = ''
  } catch (e: any) {
    bulkResults.value = { total: emails.length, sent: 0, failed: emails.length, details: [] }
  } finally {
    bulkLoading.value = false
  }
}

// ============================================================
// Section B: Invite Codes
// ============================================================
const codeForm = reactive({
  code: '',
  role: 'owner',
  max_uses: '',
  expires_in_days: '',
})
const codeLoading = ref(false)
const codeError = ref<string | null>(null)

const inviteCodes = ref<any[]>([])
const codesLoading = ref(true)

const fetchCodes = async () => {
  try {
    inviteCodes.value = await $fetch('/api/admin/invites', {
      headers: await getAuthHeaders(),
    })
  } catch { /* ignore */ } finally {
    codesLoading.value = false
  }
}

onMounted(fetchCodes)

const createCode = async () => {
  codeLoading.value = true
  codeError.value = null
  try {
    await $fetch('/api/admin/invites', {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: {
        code: codeForm.code || undefined,
        role: codeForm.role,
        max_uses: codeForm.max_uses ? Number(codeForm.max_uses) : undefined,
        expires_in_days: codeForm.expires_in_days ? Number(codeForm.expires_in_days) : undefined,
      },
    })
    codeForm.code = ''
    codeForm.max_uses = ''
    codeForm.expires_in_days = ''
    await fetchCodes()
  } catch (e: any) {
    codeError.value = e.data?.message || 'Failed to create invite code'
  } finally {
    codeLoading.value = false
  }
}

const deactivatingId = ref<string | null>(null)

const deactivateCode = async (id: string) => {
  deactivatingId.value = id
  try {
    await $fetch(`/api/admin/invites/${id}`, {
      method: 'PATCH',
      headers: await getAuthHeaders(),
    })
    await fetchCodes()
  } catch { /* ignore */ } finally {
    deactivatingId.value = null
  }
}

const copiedId = ref<string | null>(null)

const copyLink = async (code: string, id: string) => {
  const url = `${window.location.origin}/join/${code}`
  await navigator.clipboard.writeText(url)
  copiedId.value = id
  setTimeout(() => { copiedId.value = null }, 2000)
}

const formatDate = (d: string | null) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' })
}

const isExpired = (d: string | null) => {
  if (!d) return false
  return new Date(d) < new Date()
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">Invite Management</h1>

    <!-- Section A: Invite by Email -->
    <div class="mb-10">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Invite by Email</h2>

      <!-- Single invite -->
      <UCard class="mb-4">
        <template #header>
          <span class="font-medium text-gray-900 dark:text-white text-sm">Single Invite</span>
        </template>

        <form @submit.prevent="sendSingleInvite" class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Email" required>
              <UInput v-model="singleForm.email" type="email" placeholder="owner@example.com" required class="w-full" />
            </UFormField>
            <UFormField label="Role">
              <USelect v-model="singleForm.role" :items="roleOptions" value-key="value" class="w-full" />
            </UFormField>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Full name">
              <UInput v-model="singleForm.full_name" placeholder="Full name" class="w-full" />
            </UFormField>
            <UFormField label="Unit number">
              <UInput v-model="singleForm.unit_number" placeholder="e.g. 1201" class="w-full" />
            </UFormField>
          </div>

          <UAlert
            v-if="singleResult"
            :color="singleResult.success ? 'success' : 'error'"
            variant="soft"
            :description="singleResult.message"
          />

          <UButton type="submit" label="Send invite" icon="i-heroicons-paper-airplane" :loading="singleLoading" />
        </form>
      </UCard>

      <!-- Bulk invite -->
      <UCard>
        <template #header>
          <span class="font-medium text-gray-900 dark:text-white text-sm">Bulk Invite</span>
        </template>

        <form @submit.prevent="sendBulkInvites" class="space-y-3">
          <UFormField label="Emails (one per line)">
            <UTextarea v-model="bulkEmails" placeholder="owner1@example.com&#10;owner2@example.com&#10;owner3@example.com" :rows="5" class="w-full" />
          </UFormField>

          <div class="flex flex-wrap items-end gap-3">
            <UFormField label="Role">
              <USelect v-model="bulkRole" :items="roleOptions" value-key="value" class="w-44" />
            </UFormField>

            <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-1 cursor-pointer">
              <input type="checkbox" v-model="bulkSendEmail" class="rounded border-gray-300 dark:border-gray-600" />
              <span>Send invite emails</span>
            </label>
          </div>

          <p v-if="!bulkSendEmail" class="text-xs text-gray-500 dark:text-gray-400">
            Pre-approve only — accounts will be created but no emails sent. Users can sign in via the login page.
          </p>

          <UAlert
            v-if="bulkResults"
            :color="bulkResults.failed === 0 ? 'success' : bulkResults.sent > 0 ? 'warning' : 'error'"
            variant="soft"
          >
            <template #description>
              <p>{{ bulkResults.sent }} of {{ bulkResults.total }} {{ bulkSendEmail ? 'invited' : 'pre-approved' }} successfully.</p>
              <ul v-if="bulkResults.details.filter(d => !d.success).length > 0" class="mt-1 text-xs space-y-0.5">
                <li v-for="d in bulkResults.details.filter(d => !d.success)" :key="d.email">
                  {{ d.email }}: {{ d.error }}
                </li>
              </ul>
            </template>
          </UAlert>

          <UButton
            type="submit"
            :label="bulkSendEmail ? 'Send all' : 'Pre-approve all'"
            icon="i-heroicons-user-plus"
            :loading="bulkLoading"
          />
        </form>
      </UCard>
    </div>

    <!-- Section B: Invite Codes -->
    <div>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Invite Codes</h2>

      <!-- Create code -->
      <UCard class="mb-4">
        <template #header>
          <span class="font-medium text-gray-900 dark:text-white text-sm">Create Invite Code</span>
        </template>

        <form @submit.prevent="createCode" class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <UFormField label="Code (optional)">
              <UInput v-model="codeForm.code" placeholder="Auto-generated" class="w-full" />
            </UFormField>
            <UFormField label="Role">
              <USelect v-model="codeForm.role" :items="roleOptions" value-key="value" class="w-full" />
            </UFormField>
            <UFormField label="Max uses">
              <UInput v-model="codeForm.max_uses" type="number" placeholder="Unlimited" class="w-full" />
            </UFormField>
            <UFormField label="Expires in (days)">
              <UInput v-model="codeForm.expires_in_days" type="number" placeholder="Never" class="w-full" />
            </UFormField>
          </div>

          <UAlert v-if="codeError" color="error" variant="soft" :description="codeError" />

          <UButton type="submit" label="Create code" icon="i-heroicons-plus" :loading="codeLoading" />
        </form>
      </UCard>

      <!-- Codes list -->
      <div v-if="codesLoading" class="text-center py-8">
        <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-gray-400 mx-auto animate-spin" />
      </div>

      <div v-else-if="inviteCodes.length === 0" class="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
        No invite codes yet.
      </div>

      <div v-else class="space-y-3">
        <UCard v-for="inv in inviteCodes" :key="inv.id" :class="{ 'opacity-50': !inv.is_active || isExpired(inv.expires_at) }">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <code class="text-sm font-mono font-semibold text-primary-600 dark:text-primary-400">{{ inv.code }}</code>
              <UBadge color="primary" variant="subtle" size="xs">{{ inv.role.replace(/_/g, ' ') }}</UBadge>
              <UBadge v-if="!inv.is_active" color="error" variant="outline" size="xs">deactivated</UBadge>
              <UBadge v-else-if="isExpired(inv.expires_at)" color="warning" variant="outline" size="xs">expired</UBadge>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ inv.uses_count }}{{ inv.max_uses ? ` / ${inv.max_uses}` : '' }} used
              </span>
              <span v-if="inv.expires_at" class="text-xs text-gray-500 dark:text-gray-400">
                · expires {{ formatDate(inv.expires_at) }}
              </span>

              <UButton
                :icon="copiedId === inv.id ? 'i-heroicons-check' : 'i-heroicons-clipboard-document'"
                variant="ghost"
                size="xs"
                :color="copiedId === inv.id ? 'success' : 'neutral'"
                title="Copy invite link"
                @click="copyLink(inv.code, inv.id)"
              />

              <UButton
                v-if="inv.is_active"
                icon="i-heroicons-no-symbol"
                variant="ghost"
                size="xs"
                color="error"
                title="Deactivate"
                :loading="deactivatingId === inv.id"
                @click="deactivateCode(inv.id)"
              />
            </div>
          </div>

          <div v-if="inv.profiles" class="mt-1 text-xs text-gray-400">
            Created by {{ inv.profiles.full_name }} · {{ formatDate(inv.created_at) }}
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>
