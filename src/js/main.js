import { DeviceFlowAuth, canRefresh, tokenIsFresh } from "./auth-device-flow.js";
import { appConfig } from "./config.js";
import { GitHubClient } from "./github-api.js";
import { clearAuthState, loadAuthState, loadScanSnapshot, loadSettings, saveAuthState, saveScanSnapshot, saveSettings } from "./storage.js";
import "../styles.css";

const elements = {
  authView: document.querySelector("#auth-view"),
  appView: document.querySelector("#app-view"),
  clientForm: document.querySelector("#client-form"),
  owner: document.querySelector("#owner"),
  rememberAuth: document.querySelector("#remember-auth"),
  devicePanel: document.querySelector("#device-panel"),
  deviceCode: document.querySelector("#device-code"),
  deviceLink: document.querySelector("#device-link"),
  authStatus: document.querySelector("#auth-status"),
  authError: document.querySelector("#auth-error"),
  viewerLogin: document.querySelector("#viewer-login"),
  themeSelect: document.querySelector("#theme-select"),
  signOut: document.querySelector("#sign-out"),
  scanOwner: document.querySelector("#scan-owner"),
  includeArchived: document.querySelector("#include-archived"),
  scanButton: document.querySelector("#scan-button"),
  networkStatus: document.querySelector("#network-status"),
  rateLimit: document.querySelector("#rate-limit"),
  lastScan: document.querySelector("#last-scan"),
  buildVersion: document.querySelector("#build-version"),
  progress: document.querySelector("#scan-progress"),
  rows: document.querySelector("#repo-rows"),
  renovateSummary: document.querySelector("#renovate-summary"),
  renovateList: document.querySelector("#renovate-list"),
  metrics: {
    total: document.querySelector("#metric-total"),
    ready: document.querySelector("#metric-ready"),
    review: document.querySelector("#metric-review"),
    needsWork: document.querySelector("#metric-needs-work")
  }
};

let settings = loadSettings();
let authState = loadAuthState();
let auth = new DeviceFlowAuth();
let client;
let viewer;
const rateLimitBuckets = new Map();

bootstrap();

async function bootstrap() {
  bindEvents();
  applyTheme(settings.theme);
  applySettings();
  updateNetworkStatus();
  await loadBuildMeta();
  registerServiceWorker();

  if (authState) {
    await restoreSession();
  } else {
    showAuth();
  }
}

function bindEvents() {
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);

  elements.clientForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signIn();
  });

  elements.themeSelect.addEventListener("change", () => {
    settings = { ...settings, theme: elements.themeSelect.value };
    saveSettings(settings);
    applyTheme(settings.theme);
  });

  elements.signOut.addEventListener("click", () => {
    auth.cancel();
    clearAuthState();
    authState = null;
    client = null;
    viewer = null;
    showAuth();
  });

  elements.includeArchived.addEventListener("click", () => {
    settings = { ...settings, includeArchived: !settings.includeArchived };
    saveSettings(settings);
    renderArchivedToggle();
  });

  elements.scanButton.addEventListener("click", scan);
}

async function signIn() {
  hideError();
  const owner = elements.owner.value.trim() || appConfig.defaultOwner;

  settings = { ...settings, owner, rememberDevice: elements.rememberAuth.checked };
  saveSettings(settings);

  try {
    elements.clientForm.querySelector("button").disabled = true;
    const device = await auth.start({ clientId: appConfig.clientId });
    elements.deviceCode.textContent = device.userCode;
    elements.deviceLink.href = device.verificationUri;
    elements.devicePanel.hidden = false;
    elements.authStatus.textContent = "Waiting for GitHub authorization...";

    authState = await auth.poll({
      clientId: appConfig.clientId,
      deviceCode: device.deviceCode,
      interval: device.interval,
      expiresIn: device.expiresIn,
      onStatus: (message) => {
        elements.authStatus.textContent = message;
      }
    });

    saveAuthState(authState, settings.rememberDevice);
    await openApp();
  } catch (error) {
    showError(cleanError(error));
  } finally {
    elements.clientForm.querySelector("button").disabled = false;
  }
}

async function restoreSession() {
  try {
    if (!tokenIsFresh(authState) && canRefresh(authState)) {
      authState = await auth.refresh({ clientId: appConfig.clientId, refreshToken: authState.refreshToken });
      saveAuthState(authState, settings.rememberDevice);
    }

    if (!tokenIsFresh(authState)) {
      throw new Error("Sign in again to refresh GitHub access.");
    }

    await openApp();
  } catch (error) {
    clearAuthState();
    authState = null;
    showAuth();
    showError(cleanError(error));
  }
}

async function openApp() {
  client = new GitHubClient(authState.accessToken, { onRateLimit: renderRateLimit });
  viewer = await client.getViewer();
  elements.viewerLogin.textContent = viewer.login;
  elements.authView.hidden = true;
  elements.appView.hidden = false;
  elements.scanOwner.value = settings.owner || appConfig.defaultOwner;
  elements.themeSelect.value = settings.theme;
  renderArchivedToggle();

  const cached = await loadScanSnapshot(settings.owner);
  if (cached) {
    renderScan(cached, { cached: true });
  } else {
    await renderInstallationHint(settings.owner);
  }
}

async function renderInstallationHint(owner) {
  try {
    const owners = await client.getInstallationOwners();

    if (owners.some((installationOwner) => installationOwner.toLowerCase() === owner.toLowerCase())) {
      elements.progress.textContent = `Ready to scan ${owner}.`;
      return;
    }

    elements.progress.textContent = owners.length === 0
      ? `No GitHub App installations are visible. Install the app on ${owner} or sign in with an account that can access it.`
      : `No ${owner} installation is visible. Available: ${owners.join(", ")}.`;
  } catch (error) {
    elements.progress.textContent = cleanError(error);
  }
}

async function scan() {
  if (!client) {
    showAuth();
    return;
  }

  const owner = elements.scanOwner.value.trim() || appConfig.defaultOwner;
  settings = { ...settings, owner };
  saveSettings(settings);
  elements.scanButton.disabled = true;
  elements.progress.textContent = "Scanning repositories...";

  try {
    const result = await client.scanRepositories({
      owner,
      includeArchived: settings.includeArchived,
      onProgress: ({ completed, total, repo, inventory }) => {
        if (inventory) {
          elements.progress.textContent = `Found ${inventory.totalCount} repositories; scanning ${inventory.repositories.length}${settings.includeArchived ? "" : `, excluding ${inventory.archivedCount} archived`}.`;
          return;
        }

        elements.progress.textContent = `Scanned ${completed} of ${total}: ${repo}`;
      }
    });

    await saveScanSnapshot(owner, result);
    renderScan(result);
  } catch (error) {
    const cached = await loadScanSnapshot(owner);
    if (cached) {
      renderScan(cached, { cached: true });
      elements.progress.textContent = `Showing cached data. ${cleanError(error)}`;
    } else {
      elements.progress.textContent = cleanError(error);
    }
  } finally {
    elements.scanButton.disabled = false;
  }
}

function renderScan(result, { cached = false } = {}) {
  const repositories = result.repositories ?? [];
  const ready = repositories.filter((repo) => repo.status === "pass").length;
  const review = repositories.filter((repo) => repo.status === "warn").length;
  const needsWork = repositories.filter((repo) => repo.status === "fail").length;

  elements.metrics.total.textContent = repositories.length;
  elements.metrics.ready.textContent = ready;
  elements.metrics.review.textContent = review;
  elements.metrics.needsWork.textContent = needsWork;
  elements.lastScan.textContent = `${cached ? "Cached" : "Last"} scan ${new Date(result.scannedAt).toLocaleString()}`;
  elements.progress.textContent = formatScanSummary(result, repositories.length);

  if (repositories.length === 0) {
    elements.rows.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(formatEmptyRepositoryMessage(result))}</td></tr>`;
  } else {
    elements.rows.replaceChildren(...repositories.map(renderRepositoryRow));
  }

  renderRenovate(result.renovate);
}

function formatScanSummary(result, visibleCount) {
  if (!result.inventory) {
    return visibleCount ? `Showing ${visibleCount} repositories.` : "No repositories found.";
  }

  const failedCount = (result.repositories ?? []).filter((repo) => repo.checks?.some((check) => check.id === "scan")).length;
  const skippedCount = (result.repositories ?? []).filter((repo) => repo.checks?.some((check) => check.id === "rate-limit")).length;
  const failureText = failedCount ? ` ${failedCount} scan failed.` : "";
  const skippedText = skippedCount ? ` ${skippedCount} skipped by rate limit.` : "";
  const resetText = result.inventory.rateLimitResetAt ? ` Try again after ${new Date(result.inventory.rateLimitResetAt).toLocaleTimeString()}.` : "";

  return `Found ${result.inventory.totalCount} repositories; showing ${visibleCount}${result.includeArchived ? "" : `, excluding ${result.inventory.archivedCount} archived`}.${failureText}${skippedText}${resetText}`;
}

function formatEmptyRepositoryMessage(result) {
  if (result.inventory?.totalCount > 0 && !result.includeArchived && result.inventory.totalCount === result.inventory.archivedCount) {
    return "Only archived repositories were found. Use Include archived to scan them.";
  }

  if (result.inventory?.totalCount === 0) {
    return "The GitHub App installation returned zero repositories. Check repository access in the app installation settings.";
  }

  return "No repositories found.";
}

function renderRepositoryRow(repo) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>
      <a href="${repo.url}" target="_blank" rel="noreferrer">${escapeHtml(repo.name)}</a>
      <span class="meta-text">${repo.private ? "Private" : "Public"}${repo.archived ? " · Archived" : ""}</span>
    </td>
    <td>${escapeHtml(repo.description)}</td>
    <td>${escapeHtml(repo.pushedLabel)}</td>
    <td>${repo.issueCount ?? "Unknown"}</td>
    <td><span class="status-pill ${repo.status}">${statusText(repo.status)}</span></td>
    <td><div class="check-list"></div></td>
  `;

  const checks = [...repo.checks, ...repo.observations];
  row.querySelector(".check-list").replaceChildren(...checks.map(renderCheck));
  return row;
}

function renderCheck(check) {
  const item = document.createElement("span");
  item.className = `check-pill ${check.status}`;
  item.textContent = check.label;
  return item;
}

function renderRenovate(summary) {
  if (!summary) {
    return;
  }

  if (summary.error) {
    elements.renovateSummary.textContent = `Renovate PR scan failed: ${summary.error}`;
    elements.renovateList.innerHTML = `<p class="empty-state">Repository scan results are still shown.</p>`;
    return;
  }

  elements.renovateSummary.textContent = `${summary.total} open. ${summary.auto} auto-merge, ${summary.manual} manual, ${summary.unknown} unknown.`;

  if (summary.pullRequests.length === 0) {
    elements.renovateList.innerHTML = `<p class="empty-state">No open Renovate pull requests found.</p>`;
    return;
  }

  elements.renovateList.replaceChildren(...summary.pullRequests.map((pullRequest) => {
    const card = document.createElement("article");
    card.className = "renovate-card";
    card.innerHTML = `
      <span class="status-pill ${pullRequest.classification === "manual" ? "fail" : pullRequest.classification === "auto" ? "pass" : "warn"}">${escapeHtml(pullRequest.classification)}</span>
      <div>
        <a href="${pullRequest.url}" target="_blank" rel="noreferrer">${escapeHtml(pullRequest.title)}</a>
        <span class="meta-text">${escapeHtml(pullRequest.repository)} #${pullRequest.number}</span>
      </div>
    `;
    return card;
  }));
}

function applySettings() {
  elements.owner.value = settings.owner;
  elements.rememberAuth.checked = settings.rememberDevice;
  elements.themeSelect.value = settings.theme;
}

function showAuth() {
  elements.authView.hidden = false;
  elements.appView.hidden = true;
  elements.devicePanel.hidden = true;
  applySettings();
}

function renderArchivedToggle() {
  elements.includeArchived.setAttribute("aria-pressed", String(settings.includeArchived));
  elements.includeArchived.textContent = settings.includeArchived ? "Archived included" : "Include archived";
}

function renderRateLimit(rateLimit) {
  const resource = rateLimit.resource || "core";
  rateLimitBuckets.set(resource, rateLimit);

  elements.rateLimit.textContent = [...rateLimitBuckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, bucket]) => `${name}: ${bucket.remaining} of ${bucket.limit} left`)
    .join(" · ");
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function updateNetworkStatus() {
  elements.networkStatus.textContent = navigator.onLine ? "Online" : "Offline";
}

async function loadBuildMeta() {
  try {
    const response = await fetch("./build-meta.json", { cache: "no-store" });
    if (response.ok) {
      const meta = await response.json();
      elements.buildVersion.textContent = `Version ${meta.shortSha}`;
    }
  } catch {
    elements.buildVersion.textContent = "Version local";
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener("load", async () => {
    const registration = await navigator.serviceWorker.register("./sw.js");
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
  });
}

function showError(message) {
  elements.authError.textContent = message;
  elements.authError.hidden = false;
}

function hideError() {
  elements.authError.textContent = "";
  elements.authError.hidden = true;
}

function statusText(status) {
  return status === "pass" ? "Ready" : status === "warn" ? "Review" : "Needs work";
}

function cleanError(error) {
  if (error?.name === "AbortError") {
    return "Sign-in was canceled.";
  }

  return error instanceof Error ? error.message.replace(/^GitHub returned \d+:\s*/, "") : "Something went wrong.";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => {
    const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
    return replacements[character];
  });
}
