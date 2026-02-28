<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const { isAdmin } = useAuth()
const toast = useToast()

const users = ref<any[]>([])
const loading = ref(true)
const filterRole = ref('')
const filterActive = ref('all')
const updatingUser = ref<string | null>(null)

const roleOptions = [
  { label: 'All roles', value: '' },
  { label: 'Super Admin', value: 'super_admin' },
  { label: 'Trustee', value: 'trustee' },
  { label: 'Lawyer', value: 'lawyer' },
  { label: 'Building Manager', value: 'building_manager' },
  { label: 'Management Co', value: 'management_co' },
  { label: 'Owner', value: 'owner' },
  { label: 'Tenant', value: 'tenant' },
]

const activeOptions = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Deactivated', value: 'inactive' },
]

const roleColors: Record<string, string> = {
  super_admin: 'error',
  trustee: 'warning',
  lawyer: 'primary',
  building_manager: 'success',
  management_co: 'success',
  owner: 'neutral',
  tenant: 'neutral',
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

async function fetchUsers() {
  loading.value = true
  try {
    const headers = await getAuthHeaders()
    users.value = await $fetch('/api/admin/users', { headers })
  } catch (err: any) {
    toast.add({ title: 'Failed to load users', description: err?.data?.message || err.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function updateRole(userId: string, newRole: string) {
  updatingUser.value = userId
  try {
    const headers = await getAuthHeaders()
    await $fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers,
      body: { role: newRole },
    })
    toast.add({ title: 'Role updated', color: 'success' })
    await fetchUsers()
  } catch (err: any) {
    toast.add({ title: 'Failed to update role', description: err?.data?.message || err.message, color: 'error' })
  } finally {
    updatingUser.value = null
  }
}

async function toggleActive(userId: string, isActive: boolean) {
  updatingUser.value = userId
  try {
    const headers = await getAuthHeaders()
    await $fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers,
      body: { is_active: !isActive },
    })
    toast.add({ title: isActive ? 'User deactivated' : 'User reactivated', color: 'success' })
    await fetchUsers()
  } catch (err: any) {
    toast.add({ title: 'Failed to update user', description: err?.data?.message || err.message, color: 'error' })
  } finally {
    updatingUser.value = null
  }
}

const filteredUsers = computed(() => {
  return users.value.filter(u => {
    if (filterRole.value && u.role !== filterRole.value) return false
    if (filterActive.value === 'active' && !u.is_active) return false
    if (filterActive.value === 'inactive' && u.is_active) return false
    return true
  })
})

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })
}

onMounted(fetchUsers)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">User Management</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ users.length }} total users</p>
      </div>
    </div>

    <div v-if="!isAdmin" class="text-center py-12">
      <p class="text-gray-500">Admin access required.</p>
    </div>

    <template v-else>
      <!-- Filters -->
      <div class="flex gap-3 mb-4">
        <USelect v-model="filterRole" :items="roleOptions" value-key="value" class="w-44" />
        <USelect v-model="filterActive" :items="activeOptions" value-key="value" class="w-36" />
      </div>

      <div v-if="loading" class="text-center py-12 text-gray-400">Loading...</div>

      <div v-else class="space-y-3">
        <UCard v-for="u in filteredUsers" :key="u.id" :class="{ 'opacity-50': !u.is_active }">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-medium text-gray-900 dark:text-white">{{ u.full_name }}</span>
                <UBadge :color="roleColors[u.role] || 'neutral'" variant="subtle" size="xs">
                  {{ u.role.replace(/_/g, ' ') }}
                </UBadge>
                <UBadge v-if="!u.is_active" color="error" variant="outline" size="xs">deactivated</UBadge>
              </div>
              <div class="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                <span>{{ u.email }}</span>
                <span v-if="u.unit_number">Unit {{ u.unit_number }}</span>
                <span v-if="u.phone">{{ u.phone }}</span>
                <span>Joined {{ formatDate(u.created_at) }}</span>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-shrink-0">
              <USelect
                :model-value="u.role"
                :items="roleOptions.slice(1)"
                value-key="value"
                class="w-40"
                :disabled="updatingUser === u.id"
                @update:model-value="(val: string) => updateRole(u.id, val)"
              />
              <UButton
                :icon="u.is_active ? 'i-heroicons-no-symbol' : 'i-heroicons-check-circle'"
                :color="u.is_active ? 'error' : 'success'"
                variant="ghost"
                size="sm"
                :loading="updatingUser === u.id"
                @click="toggleActive(u.id, u.is_active)"
              />
            </div>
          </div>
        </UCard>

        <div v-if="filteredUsers.length === 0" class="text-center py-8 text-gray-400">
          <p class="text-sm">No users match the current filters.</p>
        </div>
      </div>
    </template>
  </div>
</template>
