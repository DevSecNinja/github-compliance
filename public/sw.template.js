const buildVersion = "__BUILD_VERSION__";
const cacheName = `github-compliance-${buildVersion}`;
const appShell = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./offline.html", "./build-meta.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      await Promise.all(
        appShell.map(async (url) => {
          const response = await fetch(new Request(url, { cache: "reload" }));
          if (response.ok) {
            await cache.put(url, response);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin === "https://api.github.com" || url.origin === "https://github.com") {
    return;
  }

  const acceptsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
  const isHtml = request.mode === "navigate" || acceptsHtml;
  const isScript = url.pathname.endsWith(".js");
  const isBuildMeta = url.pathname.endsWith("/build-meta.json");

  if (isHtml || isScript || isBuildMeta) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(new Request(request, { cache: "no-cache" }));
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    if (request.mode === "navigate") {
      return (await cache.match("./offline.html")) || (await cache.match("./index.html")) || (await cache.match("./"));
    }

    return new Response("", { status: 503, statusText: "Service Unavailable" });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(new Request(request, { cache: "no-cache" }));
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 503, statusText: "Service Unavailable" });
  }
}
