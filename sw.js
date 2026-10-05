// 電波がなくてもアプリを使えるようにするための仕組み（サービスワーカー）です。
// 一度開くと、アプリのファイルを端末に保存します。
// 次に開いたときは保存したファイルをすぐに表示し、電波があれば裏で新しい内容に更新します
// （フレーズを書き換えたときは、電波のある場所で2回開くと新しい内容になります）。

const CACHE_NAME = "tw-phrases-v2";
const APP_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./phrases.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached =
        (await cache.match(request, { ignoreSearch: true })) ||
        (request.mode === "navigate" ? await cache.match("./index.html") : undefined);

      const fromNetwork = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);

      if (cached) {
        event.waitUntil(fromNetwork); // 保存済みをすぐ返し、裏で更新
        return cached;
      }
      return (await fromNetwork) || Response.error();
    })()
  );
});
