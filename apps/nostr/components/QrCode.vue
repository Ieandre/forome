<template>
  <img v-if="src" class="qr-code" :src="src" :width="size" :height="size" alt="" />
  <div v-else class="qr-code qr-code--placeholder skeleton" :style="{ width: `${size}px`, height: `${size}px` }" />
</template>

<script setup lang="ts">
/**
 * QR généré côté client (paquet `qrcode`).
 *
 * ⚠️ Le contenu ne quitte jamais la page : ni requête réseau, ni service tiers.
 * C'est non négociable ici, puisque ce composant sert à afficher une `nsec`.
 */
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{ text: string; size?: number }>(), { size: 200 })
const src = ref('')

async function render(): Promise<void> {
  if (!props.text) {
    src.value = ''
    return
  }
  const QRCode = await import('qrcode')
  try {
    src.value = await QRCode.toDataURL(props.text, {
      width: props.size,
      margin: 1,
      errorCorrectionLevel: 'M',
      // Volontairement en dur, pas de token : un QR doit être sombre sur clair
      // dans les deux thèmes, sinon la moitié des scanners ne le lit plus.
      color: { dark: '#16191d', light: '#ffffff' },
    })
  } catch {
    src.value = ''
  }
}

watch(() => props.text, render, { immediate: true })
</script>

<style scoped>
/* Plateau blanc en dur, pour la même raison que les couleurs des modules :
   la lisibilité au scanner ne dépend pas du thème. */
.qr-code {
  display: block;
  border-radius: var(--r-panel);
  background: #ffffff;
  border: 1px solid var(--line);
  padding: 6px;
}
.qr-code--placeholder {
  border-radius: var(--r-panel);
}
</style>
