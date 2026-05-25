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

    return env.ASSETS.fetch(request);
  }
};

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
