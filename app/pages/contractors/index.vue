<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const { isAdmin } = useAuth()
const toast = useToast()

const contractors = ref<any[]>([])
const loading = ref(true)
const showForm = ref(false)
const ratingContractor = ref<string | null>(null)
const ratingValue = ref(5)
const ratingComment = ref('')
const filterSpeciality = ref('')

const specialities = [
  'plumbing', 'electrical', 'painting', 'glazing', 'locksmith',
  'appliance', 'HVAC', 'security', 'cleaning', 'landscaping',
  'general maintenance', 'other',
]

const form = reactive({
  name: '',
  company: '',
  speciality: '',
  phone: '',
  email: '',
  notes: '',
})

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

async function fetchContractors() {
  loading.value = true
  try {
    contractors.value = await $fetch('/api/contractors')
  } catch { /* empty */ } finally {
    loading.value = false
  }
}

async function addContractor() {
  if (!form.name.trim() || !form.speciality.trim()) return
  try {
    const headers = await getAuthHeaders()
    await $fetch('/api/contractors', { method: 'POST', headers, body: form })
    toast.add({ title: 'Contractor added', color: 'success' })
    showForm.value = false
    Object.assign(form, { name: '', company: '', speciality: '', phone: '', email: '', notes: '' })
    await fetchContractors()
  } catch (err: any) {
    toast.add({ title: 'Failed to add', description: err?.data?.message || err.message, color: 'error' })
  }
}

async function submitRating(contractorId: string) {
  try {
    const headers = await getAuthHeaders()
    await $fetch(`/api/contractors/${contractorId}/rate`, {
      method: 'POST',
      headers,
      body: { rating: ratingValue.value, comment: ratingComment.value },
    })
    toast.add({ title: 'Rating submitted', color: 'success' })
    ratingContractor.value = null
    ratingValue.value = 5
    ratingComment.value = ''
    await fetchContractors()
  } catch (err: any) {
    toast.add({ title: 'Failed to rate', description: err?.data?.message || err.message, color: 'error' })
  }
}

const filteredContractors = computed(() => {
  if (!filterSpeciality.value) return contractors.value
  return contractors.value.filter(c => c.speciality === filterSpeciality.value)
})

onMounted(fetchContractors)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Trusted Contractors</h1>
        <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">Community-rated service providers</p>
      </div>
      <UButton
        v-if="isAdmin"
        icon="i-heroicons-plus"
        label="Add contractor"
        @click="showForm = !showForm"
      />
    </div>

    <!-- Add form -->
    <UCard v-if="showForm && isAdmin" class="mb-6">
      <form @submit.prevent="addContractor" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Name" required>
            <UInput v-model="form.name" placeholder="Contact name" class="w-full" />
          </UFormField>
          <UFormField label="Company">
            <UInput v-model="form.company" placeholder="Company name" class="w-full" />
          </UFormField>
        </div>
        <div class="grid grid-cols-3 gap-4">
          <UFormField label="Speciality" required>
            <USelect v-model="form.speciality" :items="specialities.map(s => ({ label: s, value: s }))" value-key="value" placeholder="Select" class="w-full" />
          </UFormField>
          <UFormField label="Phone">
            <UInput v-model="form.phone" placeholder="Phone number" class="w-full" />
          </UFormField>
          <UFormField label="Email">
            <UInput v-model="form.email" type="email" placeholder="Email" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Notes">
          <UTextarea v-model="form.notes" placeholder="Additional notes..." :rows="2" class="w-full" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" variant="ghost" @click="showForm = false" />
          <UButton type="submit" label="Add contractor" />
        </div>
      </form>
    </UCard>

    <!-- Filter -->
    <div class="mb-4">
      <USelect
        v-model="filterSpeciality"
        :items="[{ label: 'All specialities', value: '' }, ...specialities.map(s => ({ label: s, value: s }))]"
        value-key="value"
        class="w-48"
      />
    </div>

    <!-- List -->
    <div v-if="loading" class="text-center py-12 text-gray-400">Loading...</div>
    <div v-else-if="filteredContractors.length === 0" class="text-center py-16">
      <UIcon name="i-heroicons-wrench-screwdriver" class="w-10 h-10 text-gray-300 mx-auto mb-3" />
      <p class="text-sm text-gray-400">No contractors found</p>
    </div>
    <div v-else class="grid gap-4 md:grid-cols-2">
      <UCard v-for="c in filteredContractors" :key="c.id">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-white">{{ c.name }}</h3>
            <p v-if="c.company" class="text-sm text-gray-500">{{ c.company }}</p>
          </div>
          <UBadge variant="subtle" size="xs">{{ c.speciality }}</UBadge>
        </div>

        <div class="mt-3 space-y-1 text-sm text-gray-600 dark:text-gray-300">
          <div v-if="c.phone" class="flex items-center gap-2">
            <UIcon name="i-heroicons-phone" class="w-4 h-4 text-gray-400" />
            <a :href="'tel:' + c.phone" class="hover:text-primary-600">{{ c.phone }}</a>
          </div>
          <div v-if="c.email" class="flex items-center gap-2">
            <UIcon name="i-heroicons-envelope" class="w-4 h-4 text-gray-400" />
            <a :href="'mailto:' + c.email" class="hover:text-primary-600">{{ c.email }}</a>
          </div>
          <p v-if="c.notes" class="text-xs text-gray-400 mt-2">{{ c.notes }}</p>
        </div>

        <!-- Rating -->
        <div class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div class="flex items-center gap-1">
            <UIcon
              v-for="star in 5"
              :key="star"
              :name="star <= Math.round(c.avg_rating || 0) ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
              class="w-4 h-4"
              :class="star <= Math.round(c.avg_rating || 0) ? 'text-amber-400' : 'text-gray-300'"
            />
            <span class="text-xs text-gray-400 ml-1">
              {{ c.avg_rating ? c.avg_rating.toFixed(1) : 'No ratings' }}
              <span v-if="c.rating_count">({{ c.rating_count }})</span>
            </span>
          </div>
          <UButton label="Rate" variant="ghost" size="xs" @click="ratingContractor = ratingContractor === c.id ? null : c.id" />
        </div>

        <!-- Rating form -->
        <div v-if="ratingContractor === c.id" class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-600 dark:text-gray-300">Rating:</span>
            <div class="flex gap-1">
              <button v-for="star in 5" :key="star" type="button" @click="ratingValue = star">
                <UIcon
                  :name="star <= ratingValue ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
                  class="w-5 h-5"
                  :class="star <= ratingValue ? 'text-amber-400' : 'text-gray-300'"
                />
              </button>
            </div>
          </div>
          <UTextarea v-model="ratingComment" placeholder="Comment (optional)" :rows="2" class="w-full" />
          <div class="flex justify-end">
            <UButton label="Submit" size="sm" @click="submitRating(c.id)" />
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
