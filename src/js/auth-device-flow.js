import { appConfig } from "./config.js";

const brokerBaseUrl = appConfig.authBrokerBaseUrl.replace(/\/$/, "");
const deviceCodeUrl = `${brokerBaseUrl}/github-auth/device-code`;
const accessTokenUrl = `${brokerBaseUrl}/github-auth/access-token`;

export class DeviceFlowAuth {
  constructor({ fetcher = (...args) => fetch(...args) } = {}) {
    this.fetcher = fetcher;
    this.abortController = null;
  }

  async start({ clientId }) {
    const payload = new URLSearchParams({ client_id: clientId });
    const response = await this.postForm(deviceCodeUrl, payload);

    if (response.error) {
      throw new Error(response.error_description || response.error);
    }

    return {
      deviceCode: response.device_code,
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      expiresIn: Number(response.expires_in),
      interval: response.interval === undefined ? 5 : Number(response.interval)
    };
  }

  async poll({ clientId, deviceCode, interval, expiresIn, onStatus }) {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const startedAt = Date.now();
    let waitSeconds = interval ?? 5;

    while (Date.now() - startedAt < expiresIn * 1000) {
      await wait(waitSeconds * 1000, this.abortController.signal);
      const payload = new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      });
      const response = await this.postForm(accessTokenUrl, payload, this.abortController.signal);

      if (response.access_token) {
        return normalizeTokenResponse(response);
      }

      if (response.error === "authorization_pending") {
        onStatus?.("Waiting for GitHub authorization...");
        continue;
      }

      if (response.error === "slow_down") {
        waitSeconds += 5;
        onStatus?.("GitHub asked us to slow down. Still waiting...");
        continue;
      }

      throw new Error(response.error_description || response.error || "GitHub authorization failed.");
    }

    throw new Error("The GitHub device code expired. Start sign-in again.");
  }

  async refresh({ clientId, refreshToken }) {
    const payload = new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });
    const response = await this.postForm(accessTokenUrl, payload);

    if (response.error) {
      throw new Error(response.error_description || response.error);
    }

    return normalizeTokenResponse(response);
  }

  cancel() {
    this.abortController?.abort();
  }

  async postForm(url, payload, signal) {
    let response;

    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: payload,
        signal
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error("GitHub sign-in endpoint is unavailable. Redeploy Cloudflare Pages so the /github-auth/* Worker route is active, or configure VITE_GITHUB_AUTH_BROKER_URL for an external broker.");
      }

      throw error;
    }

    if (!response.ok) {
      if (!appConfig.authBrokerBaseUrl) {
        throw new Error("GitHub sign-in endpoint is unavailable. Redeploy Cloudflare Pages so the /github-auth/* Worker route is active, or configure VITE_GITHUB_AUTH_BROKER_URL for an external broker.");
      }

      throw new Error(`GitHub authorization returned ${response.status}.`);
    }

    return response.json();
  }
}

export function tokenIsFresh(authState, clock = Date.now()) {
  return Boolean(authState?.accessToken && authState.expiresAt && authState.expiresAt - clock > 60_000);
}

export function canRefresh(authState, clock = Date.now()) {
  return Boolean(authState?.refreshToken && authState.refreshTokenExpiresAt && authState.refreshTokenExpiresAt - clock > 60_000);
}

function normalizeTokenResponse(response) {
  const now = Date.now();
  const expiresIn = Number(response.expires_in || 28_800);
  const refreshTokenExpiresIn = Number(response.refresh_token_expires_in || 0);

  return {
    appId: appConfig.appId,
    accessToken: response.access_token,
    refreshToken: response.refresh_token || null,
    tokenType: response.token_type || "bearer",
    expiresAt: now + expiresIn * 1000,
    refreshTokenExpiresAt: refreshTokenExpiresIn ? now + refreshTokenExpiresIn * 1000 : null
  };
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Sign-in was canceled.", "AbortError"));
      },
      { once: true }
    );
  });
}
