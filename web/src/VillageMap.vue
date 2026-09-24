<script setup>
import { computed } from 'vue'
import { villageMapLayout } from './map-layout.js'
const props = defineProps({
  points: { type: Array, required: true },
  claimPosition: { type: Object, default: null },
  completedKeys: { type: Array, default: () => [] },
  loggedIn: Boolean,
  disabled: Boolean
})
const emit = defineEmits(['view'])
const layout = computed(() => villageMapLayout(props.points, props.claimPosition))
const completed = point => props.loggedIn && props.completedKeys.includes(point.key)
const status = point => !props.loggedIn ? '查看地点' : completed(point) ? '已完成' : '待打卡'
const polyline = segment => segment.map(([x, y]) => `${x},${y}`).join(' ')
</script>

<template>
  <section class="village-map" aria-labelledby="map-title">
    <div class="section-heading"><div><p class="eyebrow">沿着风景，慢慢走</p><h2 id="map-title" tabindex="-1">长岐漫游地图</h2></div><span class="paper-tag">路线参考</span></div>
    <p class="map-caption">线路仅作行走参考，不限制打卡顺序 · 点击编号查看地点</p>
    <div class="map-canvas" :style="{ aspectRatio: `${layout.width} / ${layout.height}` }" :data-placement="layout.placement">
      <img class="map-scenery" :src="layout.image" alt="" aria-hidden="true" :width="layout.width" :height="layout.height" decoding="async" />
      <svg class="map-route-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <template v-for="(segment, index) in layout.routeSegments" :key="index">
          <polyline class="map-route-underlay" :points="polyline(segment)" vector-effect="non-scaling-stroke" />
          <polyline class="map-route-line" :points="polyline(segment)" vector-effect="non-scaling-stroke" />
        </template>
      </svg>
      <div v-if="layout.claimPosition" class="claim-map-marker"
        :style="{ left: `${layout.claimPosition.x}%`, top: `${layout.claimPosition.y}%` }" aria-label="兑奖处位置">
        <span class="claim-map-gift" aria-hidden="true">礼</span><span>兑奖处</span>
      </div>
      <ol class="map-points">
        <li v-for="node in layout.nodes" :key="node.point.key" :class="{ completed: completed(node.point) }"
          :style="{ left: `${node.x}%`, top: `${node.y}%` }">
          <button type="button" class="map-point" :data-point-key="node.point.key" :data-map-x="node.x" :data-map-y="node.y"
            :disabled="disabled" :title="node.point.name" :aria-label="`查看${node.point.name}，${status(node.point)}`" @click="emit('view', node.point)">
            <span class="map-pin" aria-hidden="true">{{ completed(node.point) ? '✓' : node.point.displayOrder }}</span>
            <span class="visually-hidden">{{ node.point.name }} · {{ status(node.point) }}</span>
          </button>
        </li>
      </ol>
    </div>
    <p v-if="layout.unmappedKeys.length" class="muted map-footnote">未标注的地点可在下方“查看全部地点”中查看。</p>
    <p class="muted map-footnote">方位和线路按现场提供的参考图调整；插画底图仍为示意，实际通行以现场指引为准。点击地图不会取得扫码资格。</p>
  </section>
</template>
