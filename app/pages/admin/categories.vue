<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const { isAdmin } = useAuth()
const toast = useToast()

const categories = ref<any[]>([])
const sensitivityRules = ref<any[]>([])
const loading = ref(true)
const showForm = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  name: '',
  description: '',
  parent_id: 'none',
})

const tierOptions = [
  { label: 'Scheme Ops', value: 'scheme_ops' },
  { label: 'Personal Financial', value: 'personal_financial' },
  { label: 'Privileged Legal', value: 'privileged_legal' },
]

const tierColors: Record<string, 'success' | 'warning' | 'error'> = {
  scheme_ops: 'success',
  personal_financial: 'warning',
  privileged_legal: 'error',
}

const tierLabels: Record<string, string> = {
  scheme_ops: 'Scheme Ops',
  personal_financial: 'Personal Financial',
  privileged_legal: 'Privileged Legal',
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

async function fetchCategories() {
  loading.value = true
  try {
    const headers = await getAuthHeaders()
    const [cats, rules] = await Promise.all([
      $fetch('/api/admin/categories', { headers }),
      $fetch<any[]>('/api/admin/sensitivity-rules', { headers }),
    ])
    categories.value = cats as any[]
    sensitivityRules.value = rules
  } catch (err: any) {
    toast.add({ title: 'Failed to load categories', description: err?.data?.message || err.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

// Get the sensitivity tier for a category
function getTierForCategory(categoryId: string): string {
  const rule = sensitivityRules.value.find(r => r.category_id === categoryId)
  return rule?.sensitivity_tier ?? 'scheme_ops'
}

// Update sensitivity tier for a category
async function updateTier(categoryId: string, newTier: string) {
  try {
    const headers = await getAuthHeaders()
    await $fetch('/api/admin/sensitivity-rules', {
      method: 'PUT',
      headers,
      body: { category_id: categoryId, sensitivity_tier: newTier },
    })
    // Update local state
    const existing = sensitivityRules.value.find(r => r.category_id === categoryId)
    if (existing) {
      existing.sensitivity_tier = newTier
    } else {
      sensitivityRules.value.push({ category_id: categoryId, sensitivity_tier: newTier })
    }
    toast.add({ title: `Sensitivity updated to "${tierLabels[newTier]}"`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Failed to update tier', description: err?.data?.message || err.message, color: 'error' })
  }
}

// Build tree structure
const categoryTree = computed(() => {
  const parents = categories.value.filter(c => !c.parent_id)
  return parents.map(parent => ({
    ...parent,
    children: categories.value.filter(c => c.parent_id === parent.id),
  })).sort((a, b) => a.name.localeCompare(b.name))
})

const parentOptions = computed(() => {
  const parents = categories.value.filter(c => !c.parent_id)
  return [
    { label: 'None (top-level)', value: 'none' },
    ...parents.map(p => ({ label: p.name, value: p.id })),
  ]
})

function resetForm() {
  form.name = ''
  form.description = ''
  form.parent_id = 'none'
  editingId.value = null
  showForm.value = false
}

function startEdit(cat: any) {
  editingId.value = cat.id
  form.name = cat.name
  form.description = cat.description || ''
  form.parent_id = cat.parent_id || 'none'
  showForm.value = true
}

async function saveCategory() {
  if (!form.name.trim()) return
  try {
    const headers = await getAuthHeaders()
    if (editingId.value) {
      await $fetch(`/api/admin/categories/${editingId.value}`, {
        method: 'PATCH',
        headers,
        body: { name: form.name, description: form.description || null, parent_id: form.parent_id === 'none' ? null : form.parent_id || null },
      })
      toast.add({ title: 'Category updated', color: 'success' })
    } else {
      await $fetch('/api/admin/categories', {
        method: 'POST',
        headers,
        body: { name: form.name, description: form.description || null, parent_id: form.parent_id === 'none' ? null : form.parent_id || null },
      })
      toast.add({ title: 'Category created', color: 'success' })
    }
    resetForm()
    await fetchCategories()
  } catch (err: any) {
    toast.add({ title: 'Failed to save', description: err?.data?.message || err.message, color: 'error' })
  }
}

async function deleteCategory(id: string) {
  try {
    const headers = await getAuthHeaders()
    await $fetch(`/api/admin/categories/${id}`, { method: 'DELETE', headers })
    toast.add({ title: 'Category deleted', color: 'success' })
    await fetchCategories()
  } catch (err: any) {
    toast.add({ title: 'Cannot delete', description: err?.data?.message || err.message, color: 'error' })
  }
}

onMounted(fetchCategories)
</script>

<template>
  <div class="max-w-4xl">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Category Management</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ categories.length }} categories — each with a sensitivity tier for PII scrubbing</p>
      </div>
      <UButton
        v-if="isAdmin"
        icon="i-heroicons-plus"
        label="Add category"
        @click="showForm = !showForm; editingId = null"
      />
    </div>

    <div v-if="!isAdmin" class="text-center py-12">
      <p class="text-gray-500">Admin access required.</p>
    </div>

    <template v-else>
      <!-- Create/edit form -->
      <UCard v-if="showForm" class="mb-6">
        <form @submit.prevent="saveCategory" class="space-y-4">
          <UFormField label="Name" required>
            <UInput v-model="form.name" placeholder="Category name" class="w-full" />
          </UFormField>
          <UFormField label="Parent category">
            <USelect v-model="form.parent_id" :items="parentOptions" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="Description">
            <UInput v-model="form.description" placeholder="Optional description" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" variant="ghost" @click="resetForm" />
            <UButton type="submit" :label="editingId ? 'Update' : 'Create'" />
          </div>
        </form>
      </UCard>

      <!-- Sensitivity tier legend -->
      <UCard class="mb-6">
        <template #header>
          <span class="font-medium text-gray-900 dark:text-white">Sensitivity Tiers</span>
        </template>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div class="flex items-start gap-2">
            <UBadge color="success" variant="soft" size="xs">Scheme Ops</UBadge>
            <span class="text-gray-500 dark:text-gray-400">Light scrub for owners (names kept, bank/ID redacted)</span>
          </div>
          <div class="flex items-start gap-2">
            <UBadge color="warning" variant="soft" size="xs">Personal Financial</UBadge>
            <span class="text-gray-500 dark:text-gray-400">Heavy scrub (all personal info redacted)</span>
          </div>
          <div class="flex items-start gap-2">
            <UBadge color="error" variant="soft" size="xs">Privileged Legal</UBadge>
            <span class="text-gray-500 dark:text-gray-400">Access restricted to trustees &amp; lawyer only</span>
          </div>
        </div>
      </UCard>

      <div v-if="loading" class="text-center py-12 text-gray-400">Loading...</div>

      <div v-else-if="categoryTree.length === 0" class="text-center py-12">
        <UIcon name="i-heroicons-folder" class="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p class="text-sm text-gray-400">No categories yet. Add one to get started.</p>
      </div>

      <div v-else class="space-y-4">
        <UCard v-for="parent in categoryTree" :key="parent.id">
          <!-- Parent category -->
          <div class="flex items-center justify-between gap-3 mb-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-folder" class="w-5 h-5 text-gray-400" />
              <span class="font-semibold text-gray-900 dark:text-white">{{ parent.name }}</span>
              <UBadge v-if="parent.is_auto_created" color="primary" variant="outline" size="xs">auto</UBadge>
              <span class="text-xs text-gray-400">{{ parent.documentCount }} docs</span>
            </div>
            <div class="flex items-center gap-2">
              <USelect
                :model-value="getTierForCategory(parent.id)"
                :items="tierOptions"
                value-key="value"
                size="xs"
                class="w-36"
                @update:model-value="(v: string) => updateTier(parent.id, v)"
              />
              <UButton icon="i-heroicons-pencil" variant="ghost" size="xs" @click="startEdit(parent)" />
              <UButton icon="i-heroicons-trash" variant="ghost" size="xs" color="error" @click="deleteCategory(parent.id)" />
            </div>
          </div>

          <!-- Description -->
          <p v-if="parent.description" class="text-xs text-gray-500 ml-7 mb-2">{{ parent.description }}</p>

          <!-- Children -->
          <div v-if="parent.children.length" class="ml-7 space-y-1">
            <div
              v-for="child in parent.children"
              :key="child.id"
              class="flex items-center justify-between gap-3 py-1.5 px-3 rounded bg-gray-50 dark:bg-gray-800"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ child.name }}</span>
                <UBadge v-if="child.is_auto_created" color="primary" variant="outline" size="xs">auto</UBadge>
                <span class="text-xs text-gray-400">{{ child.documentCount }} docs</span>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <USelect
                  :model-value="getTierForCategory(child.id)"
                  :items="tierOptions"
                  value-key="value"
                  size="xs"
                  class="w-36"
                  @update:model-value="(v: string) => updateTier(child.id, v)"
                />
                <UButton icon="i-heroicons-pencil" variant="ghost" size="xs" @click="startEdit(child)" />
                <UButton icon="i-heroicons-trash" variant="ghost" size="xs" color="error" @click="deleteCategory(child.id)" />
              </div>
            </div>
          </div>
          <p v-else class="text-xs text-gray-400 ml-7 italic">No sub-categories</p>
        </UCard>
      </div>
    </template>
  </div>
</template>
