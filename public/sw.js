/**
 * Service worker do Hot Dash — o que torna o painel INSTALÁVEL como app
 * (janela própria no Chrome do computador, ícone na tela do celular) e o que
 * entrega as notificações de venda.
 *
 * O que ele NÃO faz, de propósito: guardar o painel para funcionar offline.
 * O Hot Dash lê tudo do servidor, e as telas são feitas de pedaços com hash no
 * nome (Next.js) que mudam a cada deploy — guardar a casca de `/dashboard`,
 * como era antes, dava uma tela branca quebrada sem rede, porque o HTML
 * guardado apontava para pedaços que não estavam no cache. Agora o único
 * arquivo guardado é `/offline.html`, que não depende de nada e diz a verdade.
 *
 * Efeito colateral bom: como nada do app fica em cache, NÃO existe versão
 * velha para invalidar. O `CACHE` abaixo só precisa mudar se o conteúdo desta
 * lista mudar — não a cada release.
 */
const CACHE = "hotdash-offline-v1";
const OFFLINE = "/offline.html";
// Só a página offline e o manifesto. O ícone dela vai EMBUTIDO no próprio
// HTML: o `fetch` abaixo só intercepta navegação, então um `<img src>` iria à
// rede e apareceria quebrado exatamente na tela em que nada carrega.
const PRECACHE = [OFFLINE, "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Só NAVEGAÇÃO passa por aqui. Tudo o mais — API, imagem, script, folha de
  // estilo — vai direto à rede, sem o service worker no meio: ele não tem nada
  // a acrescentar e cada interceptação é uma chance a mais de servir algo
  // velho. (A limpeza de metadados das mídias, por exemplo, precisa SEMPRE ir
  // à rede.)
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE).then((r) => r || new Response("Sem conexão.", { status: 503 })),
    ),
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
