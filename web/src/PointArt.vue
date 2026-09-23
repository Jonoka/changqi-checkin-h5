<script setup>
import { ref, watch } from 'vue'
const props = defineProps({ point: { type: Object, required: true }, variant: { type: String, default: 'detail' }, eager: Boolean })
const failed = ref(false)
watch(() => [props.point.key, props.point.image], () => { failed.value = false })
</script>

<template>
  <span class="point-art-frame" :class="`art-${variant}`" :data-art-key="point.key">
    <img v-if="point.image && !failed" :key="point.image" class="point-art" :src="point.image" :alt="variant === 'detail' ? (point.imageAlt || `${point.name}主题插画（非实景）`) : ''"
      :width="point.imageWidth" :height="point.imageHeight" :loading="eager ? 'eager' : 'lazy'" decoding="async" :style="{ objectPosition: point.imagePosition || '50% 50%' }" @error="failed = true" />
    <span v-else class="art-unavailable" role="img" :aria-label="`${point.name}插画暂不可用`">插画暂不可用</span>
  </span>
</template>
