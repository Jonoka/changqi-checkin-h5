<script setup>
defineProps({ points: Array, completedKeys: { type: Array, default: () => [] }, loggedIn: Boolean, disabled: Boolean })
const emit = defineEmits(['view'])
</script>

<template>
  <section class="village-map" aria-labelledby="map-title">
    <div class="section-heading"><div><p class="eyebrow">沿着风景，慢慢走</p><h2 id="map-title" tabindex="-1">长岐漫游地图</h2></div><span class="paper-tag">游览示意</span></div>
    <p class="map-caption">地点不分先后 · 图示不作实际导航</p>
    <div class="map-canvas">
      <img class="map-scenery" src="/art/village.webp" alt="" aria-hidden="true" loading="lazy" width="650" height="310" />
      <ol class="map-points">
        <li v-for="point in points" :key="point.key" :class="{ completed: completedKeys.includes(point.key) }">
          <button type="button" class="map-point" :disabled="disabled" :aria-label="`查看${point.name}，${!loggedIn ? '登录后查看进度' : completedKeys.includes(point.key) ? '已完成' : '未完成'}`" @click="emit('view', point)">
            <span class="map-pin" aria-hidden="true">{{ completedKeys.includes(point.key) ? '✓' : point.displayOrder }}</span>
            <span class="map-label">{{ point.name }}</span>
            <small>{{ !loggedIn ? '查看地点' : completedKeys.includes(point.key) ? '已完成' : '待打卡' }}</small>
          </button>
        </li>
      </ol>
    </div>
    <p class="muted map-footnote">地图与列表只用于查看地点。到达后，请用页面内扫一扫识别地点码。</p>
  </section>
</template>
