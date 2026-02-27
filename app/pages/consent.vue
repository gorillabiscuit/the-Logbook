<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

const user = useSupabaseUser()
const { fetchProfile } = useProfile()
const loading = ref(false)
const error = ref<string | null>(null)

const CONSENT_VERSION = '1.0'

const accept = async () => {
  if (!user.value) return

  loading.value = true
  error.value = null

  try {
    await $fetch('/api/consent', {
      method: 'POST',
      body: { consent_version: CONSENT_VERSION },
    })

    await fetchProfile()
    await navigateTo('/')
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Failed to record consent'
    loading.value = false
  }
}
</script>

<template>
  <div>
    <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-1">Participation Agreement</h2>
    <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
      Please read and accept the following agreement before accessing The Logbook.
    </p>

    <div class="prose prose-sm dark:prose-invert max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-6 text-sm text-gray-700 dark:text-gray-300 space-y-3">
      <p><strong>The Logbook — Participation Agreement (v{{ CONSENT_VERSION }})</strong></p>

      <p>
        This platform is operated by and for the residential owners of The Yacht Club Sectional Title Scheme
        (the "Scheme"), Cape Town, South Africa. It exists to consolidate collective knowledge, support building
        management, and preserve institutional memory for residential owners.
      </p>

      <p><strong>1. Purpose &amp; Scope</strong></p>
      <p>
        The Logbook is a private platform accessible only to verified residential owners, trustees, and
        authorised parties of the Scheme. It is not affiliated with, and expressly excludes, the developer
        AMDEC Group or its representatives.
      </p>

      <p><strong>2. Protection of Personal Information (POPIA)</strong></p>
      <p>
        Your personal information (name, email, unit number, phone) is collected for the purpose of operating
        this platform. It will not be shared with third parties without your consent, except as required by
        law. You may request access to, correction of, or deletion of your personal information at any time
        by contacting the platform administrator.
      </p>

      <p><strong>3. Document Privacy</strong></p>
      <p>
        Documents you upload are classified as <em>shared</em>, <em>private</em>, or <em>privileged</em>
        based on your selection. Shared documents are visible to all authenticated members. Private documents
        are visible to you and the trustees/lawyer only. Privileged documents (legal strategy) are visible
        to trustees and the lawyer only.
      </p>

      <p><strong>4. Legal Proceedings</strong></p>
      <p>
        This platform may be used to support legal proceedings. By uploading documents or information, you
        acknowledge that such material may be referenced in legal contexts, subject to appropriate privilege
        protections.
      </p>

      <p><strong>5. Acceptable Use</strong></p>
      <p>
        You agree to use this platform only for legitimate purposes related to the management and governance
        of the Scheme. You must not upload false, defamatory, or illegally obtained material.
      </p>

      <p><strong>6. Account Security</strong></p>
      <p>
        You are responsible for maintaining the security of your account. Magic link sign-in links must not
        be shared. Report any suspected unauthorised access to the administrator immediately.
      </p>

      <p><strong>7. Data Retention</strong></p>
      <p>
        Data is retained for the duration of the Scheme's existence and as required by sectional title law.
        Individual account data may be deactivated upon written request.
      </p>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :description="error"
      class="mb-4"
    />

    <UButton
      label="I agree to the Participation Agreement"
      :loading="loading"
      class="w-full"
      justify="center"
      @click="accept"
    />

    <p class="text-xs text-center text-gray-400 mt-3">
      By clicking above, you confirm you have read and agree to the terms above.
    </p>
  </div>
</template>
