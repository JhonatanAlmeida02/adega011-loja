/* Service worker simples da Adega011: deixa o app instalável e abre offline.
 * - Arquivos estáticos (JS/CSS, ícones, ilustrações, fontes): cache primeiro.
 * - Páginas: rede primeiro; sem internet, mostra a última versão ou /offline.html.
 * - Nunca guarda /admin nem chamadas ao Supabase.
 */
const VERSAO = "adega011-v1";
const ESSENCIAIS = ["/offline.html", "/logo-selo.svg", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const estatico = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/icons/") ||
  url.pathname.startsWith("/marca/") ||
  url.pathname.startsWith("/produtos/") ||
  url.pathname === "/logo-selo.svg";

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api")) return;

  if (estatico(url)) {
    e.respondWith(
      caches.match(req).then(
        (salvo) =>
          salvo ||
          fetch(req).then((resp) => {
            if (resp.ok) {
              const copia = resp.clone();
              caches.open(VERSAO).then((c) => c.put(req, copia));
            }
            return resp;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp.ok) {
            const copia = resp.clone();
            caches.open(VERSAO).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => caches.match(req).then((salvo) => salvo || caches.match("/offline.html"))),
    );
  }
});
