<script setup>
defineProps({ me: Object, activity: Object, inWechat: Boolean, identityState: String, identityMessage: String, locked: Boolean, compact: Boolean })
const emit = defineEmits(['refresh', 'login'])
</script>

<template>
  <section class="identity-block" :class="{ 'progress-strip paper-card': !compact, 'detail-progress': compact }" aria-live="polite" aria-label="漫游进度">
    <p v-if="identityState === 'loading'" role="status">正在读取漫游记录…</p>
    <template v-else-if="me">
      <div class="progress-heading"><p>{{ me.allCompleted ? '已集齐全部地点' : '漫游进度' }}</p><strong class="point-count">{{ me.completedCount }}/{{ me.totalCount }}</strong><button v-if="!compact" type="button" class="text-button" :disabled="locked" @click="emit('refresh')">刷新状态</button></div>
      <progress class="progress-track" :value="me.completedCount" :max="me.totalCount" :aria-label="`已完成 ${me.completedCount}，共 ${me.totalCount} 个地点`"></progress>
    </template>
    <template v-else-if="identityState === 'error'">
      <p class="muted" role="alert">{{ identityMessage || '暂时无法读取漫游记录，请重试。' }}</p>
      <button type="button" class="secondary" :disabled="locked" @click="emit('refresh')">重试读取身份</button>
    </template>
    <p v-else-if="!inWechat && !activity.developmentDemo" class="muted">共 {{ activity.points.length }} 处地点，可先浏览地图。</p>
    <template v-else>
      <p class="muted" role="status">{{ identityMessage || '请先识别微信身份，再开始漫游。' }}</p>
      <button v-if="inWechat && !activity.developmentDemo && activity.wechatLoginAvailable" type="button" @click="emit('login')">重新识别微信身份</button>
      <p v-if="inWechat && !activity.developmentDemo && !activity.wechatLoginAvailable" class="muted">微信接入尚未配置完成，请稍后从公众号菜单重试。</p>
      <button type="button" class="secondary" :disabled="locked" @click="emit('refresh')">重试读取身份</button>
    </template>
  </section>
</template>
