// Service Worker mínimo do Hot Dash (habilita instalação como PWA no iPhone).
// Estratégia: network-first para navegação, com fallback ao cache do app shell.
const CACHE = "hotdash-v1";
const APP_SHELL = ["/", "/dashboard", "/login", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Nunca intercepta APIs (limpeza de metadados precisa ir sempre à rede).
  if (request.method !== "GET" || request.url.includes("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        // Atualiza cache de navegação em segundo plano.
        if (request.mode === "navigate") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match("/dashboard"))),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const title = data.title || "Notificação";
    const options = {
      body: data.body,
      icon: "/logo.png",
      badge: "/logo.png", // Ícone para PWA no Android/iOS
      data: {
        url: data.url || "/dashboard",
      },
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    console.error("Erro ao fazer parse do push data", e);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data.url;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Se já houver uma aba aberta com esse app, foca nela e redireciona.
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // Se não, abre uma nova aba com a URL desejada.
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
