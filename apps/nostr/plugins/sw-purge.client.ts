/**
 * Forome n'a pas de service worker — celui-ci désenregistre donc tout SW trouvé
 * sur l'origine, et purge ses caches.
 *
 * Le bug qu'il tue : un SW fantôme d'un AUTRE projet servi jadis sur le même
 * port interceptait toutes les requêtes (le scope d'un SW est l'origine, donc
 * `localhost:3002` tout entier) et servait son cache stale-while-revalidate —
 * jusqu'à répondre `main.css` en `text/css` à un import de module JS, ce qui
 * tuait le boot avant le montage de Vue : squelette infini, réparé par hard
 * refresh seulement (un hard reload bypasse le SW). Et il était immortel : à la
 * mise à jour, `/sw.js` reçoit le fallback SPA en `text/html`, et un mauvais
 * MIME ne désenregistre pas — seul un 404 le ferait.
 *
 * ⚠️ Si Forome adopte un jour son propre SW, ce plugin le tuerait aussi.
 */
export default defineNuxtPlugin(() => {
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const r of regs) void r.unregister()
    })
  }
  if ('caches' in window) {
    void caches.keys().then((keys) => {
      for (const k of keys) void caches.delete(k)
    })
  }
})
