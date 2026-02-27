<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">The Logbook</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">The Yacht Club Residential Body Corporate</p>
      </div>
      <UCard>
        <slot />
      </UCard>
    </div>
  </div>
</template>
