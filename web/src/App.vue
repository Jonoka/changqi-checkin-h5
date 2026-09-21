<script setup>
import { onMounted, ref } from 'vue'

const activity = ref(null)
const error = ref('')

async function loadActivity() {
  error.value = ''
  try {
    const response = await fetch('/api/activity')
    const payload = await response.json()
    if (!response.ok || !payload.ok) throw new Error(payload.error?.message || '活动配置读取失败')
    activity.value = payload.data
  } catch (cause) {
    error.value = cause.message
  }
}

onMounted(loadActivity)
</script>

<template>
  <main class="page-shell">
    <section v-if="activity" class="activity-card">
      <p class="eyebrow">漫游进度</p>
      <h1>{{ activity.activityName }}</h1>
      <p class="intro">上传现场照片，记录你的长岐村漫游。</p>
      <div class="point-count">{{ activity.points.length }} 个地点</div>
      <ul class="point-list">
        <li v-for="point in activity.points" :key="point.key">
          <span class="point-index">{{ point.displayOrder }}</span>
          <span>{{ point.name }}</span>
        </li>
      </ul>
    </section>
    <section v-else-if="error" class="activity-card error-card" role="alert">
      <h1>暂时无法打开活动</h1>
      <p>{{ error }}</p>
      <button type="button" @click="loadActivity">重新加载</button>
    </section>
    <p v-else class="loading">正在打开活动…</p>
  </main>
</template>
