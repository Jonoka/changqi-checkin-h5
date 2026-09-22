<script setup>
defineProps({ activity: Object, me: Object, inWechat: Boolean, state: Object, locked: Boolean, demoBusy: Boolean, demoResult: String, secondary: Boolean })
const emit = defineEmits(['scan', 'prepare', 'demo-scan', 'update:demoResult'])
</script>

<template>
  <div class="scan-controls" :class="{ 'scan-dock': !secondary, 'scan-secondary': secondary }">
    <template v-if="activity.developmentDemo">
      <label for="demo-qr">开发演示地点码</label>
      <input id="demo-qr" :value="demoResult" type="text" autocomplete="off" @input="emit('update:demoResult', $event.target.value)" />
      <button type="button" :disabled="!me || !activity.enabled || demoBusy || locked" @click="emit('demo-scan')">识别演示地点码</button>
    </template>
    <template v-else>
      <button type="button" :class="{ secondary }" :disabled="!me || !inWechat || !activity.enabled || locked || state.phase !== 'ready'" @click="emit('scan')">扫一扫打卡</button>
      <button v-if="me && inWechat && ['error', 'idle'].includes(state.phase)" type="button" class="secondary" :disabled="locked" @click="emit('prepare')">重新准备扫一扫</button>
    </template>
    <p v-if="state.message" class="scan-message muted" role="status">{{ state.message }}</p>
  </div>
</template>
