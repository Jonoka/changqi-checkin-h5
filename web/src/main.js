import { createApp } from 'vue'
import App from './App.vue'
import ClaimPage from './ClaimPage.vue'
import './style.css'

// Claim links are a public read/confirm flow, never an OAuth or photo-upload entry.
createApp(/^\/r(?:\/|$)/i.test(window.location.pathname) ? ClaimPage : App).mount('#app')
