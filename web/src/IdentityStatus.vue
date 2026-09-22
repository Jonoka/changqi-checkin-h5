<script setup>
defineProps({ me: Object, activity: Object, inWechat: Boolean, identityState: String, identityMessage: String, locked: Boolean, compact: Boolean })
const emit = defineEmits(['refresh', 'login'])
</script>

<template>
  <section class="identity-block" :class="{ 'progress-strip paper-card': !compact, 'detail-progress': compact }" aria-live="polite" aria-label="本人漫游进度">
    <template v-if="me">
      <div class="progress-heading"><p>{{ me.allCompleted ? '已集齐全部地点' : '漫游进度' }}</p><strong class="point-count">{{ me.completedCount }}/{{ me.totalCount }}</strong></div>
      <progress class="progress-track" :value="me.completedCount" :max="me.totalCount" :aria-label="`已完成 ${me.completedCount}，共 ${me.totalCount} 个地点`"></progress>
      <div v-if="!compact" class="progress-footer"><span>{{ me.userLabel }} · 本人</span><button type="button" class="text-button" :disabled="locked" @click="emit('refresh')">刷新本人状态</button></div>
    </template>
    <template v-else>
      <p v-if="identityState === 'loading'" role="status">正在恢复本人身份…</p>
      <p>登录后显示本人进度 · 共 {{ activity.points.length }} 个地点</p>
      <p v-if="identityMessage" class="muted" role="status">{{ identityMessage }}</p>
      <button v-if="inWechat && !activity.developmentDemo && activity.wechatLoginAvailable" type="button" @click="emit('login')">重新识别微信身份</button>
      <p v-if="inWechat && !activity.developmentDemo && !activity.wechatLoginAvailable" class="muted">微信接入尚未配置完成，请稍后从公众号菜单重试。</p>
      <button type="button" class="secondary" :disabled="locked" @click="emit('refresh')">重试读取身份</button>
    </template>
  </section>
</template>
