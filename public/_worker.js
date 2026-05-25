const githubAuthRoutes = {
  "/github-auth/device-code": "https://github.com/login/device/code",
  "/github-auth/access-token": "https://github.com/login/oauth/access_token"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (githubAuthRoutes[url.pathname]) {
      return handleGitHubAuth(request, url, githubAuthRoutes[url.pathname]);
    }

    return handleStaticAsset(request, env, url);
  }
};

async function handleStaticAsset(request, env, url) {
  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get("Content-Type") || "";

  if (isVersionedAsset(url) && contentType.includes("text/html")) {
    return missingVersionedAssetResponse(url);
  }

  return withCacheHeaders(response, url);
}

function missingVersionedAssetResponse(url) {
  if (url.pathname.endsWith(".js")) {
    return new Response(
      `const url = new URL(globalThis.location.href);\nurl.searchParams.set("refresh", Date.now().toString());\nglobalThis.location.replace(url);\nexport {};\n`,
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/javascript; charset=utf-8",
          "X-Recovering-Asset": "1"
        }
      }
    );
  }

  if (url.pathname.endsWith(".css")) {
    return new Response("", {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/css; charset=utf-8",
        "X-Recovering-Asset": "1"
      }
    });
  }

  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" }
  });
}

function withCacheHeaders(response, url) {
  const headers = new Headers(response.headers);

  if (url.pathname === "/" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/sw.js") || url.pathname.endsWith("/build-meta.json")) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isVersionedAsset(url) {
  return url.pathname.startsWith("/assets/") && /\.(js|css)$/.test(url.pathname);
}

async function handleGitHubAuth(request, url, targetUrl) {
  const cors = corsHeaders(request, url);

  if (!cors.allowed) {
    return new Response("Origin not allowed", {
      status: 403,
      headers: cors.headers
    });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors.headers
    });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...cors.headers, Allow: "POST, OPTIONS" }
    });
  }

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": request.headers.get("Content-Type") || "application/x-www-form-urlencoded"
    },
    body: await request.text()
  });

  return new Response(await response.text(), {
    status: response.status,
    headers: {
      ...cors.headers,
      "Cache-Control": "no-store",
      "Content-Type": response.headers.get("Content-Type") || "application/json"
    }
  });
}

function corsHeaders(request, url) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    Vary: "Origin"
  };

  if (!origin) {
    return { allowed: true, headers };
  }

  if (!originIsAllowed(origin, url)) {
    return { allowed: false, headers };
  }

  return {
    allowed: true,
    headers: {
      ...headers,
      "Access-Control-Allow-Origin": origin
    }
  };
}

function originIsAllowed(origin, url) {
  try {
    const originUrl = new URL(origin);
    return originUrl.hostname === url.hostname || originUrl.hostname === "gh-compliance.ravensberg.org" || originUrl.hostname.endsWith(".pages.dev");
  } catch {
    return false;
  }
}
