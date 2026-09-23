<script setup>
import { computed } from 'vue'
import { villageMapLayout } from './map-layout.js'
const props = defineProps({ points: { type: Array, required: true }, completedKeys: { type: Array, default: () => [] }, loggedIn: Boolean, disabled: Boolean })
const emit = defineEmits(['view'])
const layout = computed(() => villageMapLayout(props.points))
const status = point => !props.loggedIn ? '查看地点' : props.completedKeys.includes(point.key) ? '已完成' : '待打卡'
</script>

<template>
  <section class="village-map" aria-labelledby="map-title">
    <div class="section-heading"><div><p class="eyebrow">沿着风景，慢慢走</p><h2 id="map-title" tabindex="-1">长岐漫游地图</h2></div><span class="paper-tag">游览示意</span></div>
    <p class="map-caption">不限顺序 · 点击地标查看这一站</p>
    <div class="map-canvas" :style="{ aspectRatio: `${layout.width} / ${layout.height}` }" :data-placement="layout.placement">
      <img class="map-scenery" :src="layout.image" alt="" aria-hidden="true" :width="layout.width" :height="layout.height" decoding="async" />
      <ol class="map-points">
        <li v-for="node in layout.nodes" :key="node.point.key" :class="{ completed: loggedIn && completedKeys.includes(node.point.key) }"
          :style="{ left: `${node.x}%`, top: `${node.y}%` }">
          <button type="button" class="map-point" :data-point-key="node.point.key" :data-map-x="node.x" :data-map-y="node.y" :disabled="disabled"
            :aria-label="`查看${node.point.name}，${status(node.point)}`" @click="emit('view', node.point)">
            <span class="map-label"><span class="map-pin" aria-hidden="true">{{ node.point.displayOrder }}</span><span>{{ node.point.name }}</span></span>
            <small class="map-state"><span v-if="loggedIn && completedKeys.includes(node.point.key)" aria-hidden="true">✓ </span>{{ status(node.point) }}</small>
          </button>
        </li>
      </ol>
    </div>
    <p v-if="layout.unmappedKeys.length" class="muted map-footnote">未标注的地点可在下方“查看全部地点”中查看。</p>
    <p class="muted map-footnote">插画不是实景。位置以现场指引为准；点击地图不会取得扫码资格。</p>
  </section>
</template>
