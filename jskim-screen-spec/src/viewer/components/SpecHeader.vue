<script setup lang="ts">
defineProps<{
  projectName: string;
}>();
</script>

<template>
  <header class="spec-header">
    <div class="spec-header__inner">
      <p class="spec-header__brand">JSKim 画面設計書</p>
      <p class="spec-header__project">プロジェクト: {{ projectName }}</p>
    </div>
  </header>
</template>
