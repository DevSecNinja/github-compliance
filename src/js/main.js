import { DeviceFlowAuth, canRefresh, tokenIsFresh } from "./auth-device-flow.js";
import { relativeTime } from "./compliance.js";
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
  advancedScanButton: document.querySelector("#advanced-scan-button"),
  networkStatus: document.querySelector("#network-status"),
  rateLimit: document.querySelector("#rate-limit"),
  lastScan: document.querySelector("#last-scan"),
  buildVersion: document.querySelector("#build-version"),
  progress: document.querySelector("#scan-progress"),
  rows: document.querySelector("#repo-rows"),
  repoStatusFilter: document.querySelector("#repo-status-filter"),
  repoCheckFilter: document.querySelector("#repo-check-filter"),
  repoPushFilter: document.querySelector("#repo-push-filter"),
  repoVisibilityFilter: document.querySelector("#repo-visibility-filter"),
  repoTextFilter: document.querySelector("#repo-text-filter"),
  clearRepoFilters: document.querySelector("#clear-repo-filters"),
  tabs: [...document.querySelectorAll(".tab-button")],
  panels: [...document.querySelectorAll(".tab-panel")],
  renovateSummary: document.querySelector("#renovate-summary"),
  renovateList: document.querySelector("#renovate-list"),
  renovateMergeFilter: document.querySelector("#renovate-merge-filter"),
  renovateTextFilter: document.querySelector("#renovate-text-filter"),
  clearRenovateFilters: document.querySelector("#clear-renovate-filters"),
  refreshRenovateButton: document.querySelector("#refresh-renovate-button"),
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
let currentScanResult;
let activeScanController;
let activeScanKind;

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
  elements.advancedScanButton.addEventListener("click", advancedScan);
  elements.refreshRenovateButton.addEventListener("click", refreshRenovatePullRequests);
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  });
  elements.renovateMergeFilter.addEventListener("change", () => renderCurrentRenovate());
  elements.renovateTextFilter.addEventListener("input", () => renderCurrentRenovate());
  elements.clearRenovateFilters.addEventListener("click", () => {
    elements.renovateMergeFilter.value = "actionable";
    elements.renovateTextFilter.value = "";
    renderCurrentRenovate();
  });
  elements.repoStatusFilter.addEventListener("change", () => renderCurrentScan());
  elements.repoCheckFilter.addEventListener("change", () => renderCurrentScan());
  elements.repoPushFilter.addEventListener("change", () => renderCurrentScan());
  elements.repoVisibilityFilter.addEventListener("change", () => renderCurrentScan());
  elements.repoTextFilter.addEventListener("input", () => renderCurrentScan());
  elements.clearRepoFilters.addEventListener("click", () => {
    elements.repoStatusFilter.value = "all";
    elements.repoCheckFilter.value = "all";
    elements.repoPushFilter.value = "all";
    elements.repoVisibilityFilter.value = "all";
    elements.repoTextFilter.value = "";
    renderCurrentScan();
  });
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
    currentScanResult = cached;
    renderScan(cached, { cached: true });
  } else {
    updateAdvancedScanButton();
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
  if (activeScanKind === "fast") {
    pauseActiveScan("Fast scan paused.");
    return;
  }

  if (!client) {
    showAuth();
    return;
  }

  const owner = elements.scanOwner.value.trim() || appConfig.defaultOwner;
  selectTab("repositories");
  settings = { ...settings, owner };
  saveSettings(settings);
  startActiveScan("fast");
  elements.progress.textContent = "Scanning repositories...";
  currentScanResult = null;
  renderScan({ owner, includeArchived: settings.includeArchived, scannedAt: new Date().toISOString(), repositories: [], renovate: null });

  try {
    const result = await client.scanRepositories({
      owner,
      includeArchived: settings.includeArchived,
      signal: activeScanController.signal,
      onProgress: ({ completed, total, repo, inventory }) => {
        if (inventory) {
          currentScanResult = {
            owner,
            includeArchived: settings.includeArchived,
            scannedAt: new Date().toISOString(),
            inventory: {
              totalCount: inventory.totalCount,
              archivedCount: inventory.archivedCount,
              scannedCount: completed
            },
            repositories: [],
            renovate: null
          };
          renderScan(currentScanResult);
          elements.progress.textContent = `Found ${inventory.totalCount} repositories; scanning ${inventory.repositories.length}${settings.includeArchived ? "" : `, excluding ${inventory.archivedCount} archived`}.`;
          return;
        }

        elements.progress.textContent = `Scanned ${completed} of ${total}: ${repo}`;
      },
      onRepositoryResult: (repository, { completed, total }) => {
        if (!currentScanResult) {
          return;
        }

        currentScanResult.inventory.scannedCount = completed;
        upsertRepository(currentScanResult, repository);
        renderScan(currentScanResult);
        elements.progress.textContent = `Scanned ${completed} of ${total}: ${repository.name}`;
      }
    });

    currentScanResult = result;
    await saveScanSnapshot(owner, result);
    renderScan(result);
  } catch (error) {
    if (error?.name === "AbortError") {
      await savePartialScan(owner, "Fast scan paused. Showing partial results.");
      return;
    }

    const cached = await loadScanSnapshot(owner);
    if (cached) {
      renderScan(cached, { cached: true });
      elements.progress.textContent = `Showing cached data. ${cleanError(error)}`;
    } else {
      elements.progress.textContent = cleanError(error);
    }
  } finally {
    stopActiveScan("fast");
    updateAdvancedScanButton();
  }
}

async function advancedScan() {
  if (activeScanKind === "advanced") {
    pauseActiveScan("Advanced scan paused.");
    return;
  }

  if (!client || !currentScanResult?.repositories?.length) {
    return;
  }

  selectTab("repositories");
  startActiveScan("advanced");
  elements.progress.textContent = "Running advanced scan...";

  try {
    const result = await client.advancedScanRepositories({
      repositories: currentScanResult.repositories,
      signal: activeScanController.signal,
      onProgress: ({ completed, total, repo }) => {
        elements.progress.textContent = `Advanced scanned ${completed} of ${total}: ${repo}`;
      },
      onRepositoryResult: (repository, { completed, total }) => {
        upsertRepository(currentScanResult, repository);
        currentScanResult.inventory = {
          ...(currentScanResult.inventory ?? {}),
          advancedScannedCount: completed
        };
        currentScanResult.advancedScannedAt = new Date().toISOString();
        renderScan(currentScanResult);
        elements.progress.textContent = `Advanced scanned ${completed} of ${total}: ${repository.name}`;
      }
    });

    currentScanResult = {
      ...currentScanResult,
      repositories: result.repositories,
      advancedScannedAt: new Date().toISOString(),
      inventory: {
        ...(currentScanResult.inventory ?? {}),
        advancedRateLimited: result.rateLimited,
        advancedRateLimitResetAt: result.rateLimitResetAt
      }
    };
    await saveScanSnapshot(currentScanResult.owner, currentScanResult);
    renderScan(currentScanResult);
  } catch (error) {
    if (error?.name === "AbortError") {
      await savePartialScan(currentScanResult.owner, "Advanced scan paused. Showing partial results.");
      return;
    }

    elements.progress.textContent = cleanError(error);
  } finally {
    stopActiveScan("advanced");
    updateAdvancedScanButton();
  }
}

async function savePartialScan(owner, message) {
  if (currentScanResult?.repositories?.length) {
    currentScanResult.scannedAt = new Date().toISOString();
    await saveScanSnapshot(owner, currentScanResult);
    renderScan(currentScanResult);
  }

  elements.progress.textContent = message;
}

function startActiveScan(kind) {
  activeScanController = new AbortController();
  activeScanKind = kind;

  if (kind === "fast") {
    elements.scanButton.disabled = false;
    elements.scanButton.textContent = "Pause scan";
    elements.advancedScanButton.disabled = true;
  } else {
    elements.scanButton.disabled = true;
    elements.advancedScanButton.disabled = false;
    elements.advancedScanButton.textContent = "Pause advanced";
  }

  elements.includeArchived.disabled = true;
  elements.refreshRenovateButton.disabled = true;
}

function stopActiveScan(kind) {
  if (activeScanKind !== kind) {
    return;
  }

  activeScanController = undefined;
  activeScanKind = undefined;
  elements.scanButton.disabled = false;
  elements.scanButton.textContent = "Scan repositories";
  elements.advancedScanButton.textContent = "Advanced scan";
  elements.includeArchived.disabled = false;
  updateRefreshRenovateButton();
}

function pauseActiveScan(message) {
  activeScanController?.abort();
  elements.progress.textContent = message;
}

function renderScan(result, { cached = false } = {}) {
  const repositories = result.repositories ?? [];
  updateCheckFilterOptions(repositories);
  const filteredRepositories = filterRepositories(repositories);
  const ready = repositories.filter((repo) => repo.status === "pass").length;
  const review = repositories.filter((repo) => repo.status === "warn").length;
  const needsWork = repositories.filter((repo) => repo.status === "fail").length;

  elements.metrics.total.textContent = repositories.length;
  elements.metrics.ready.textContent = ready;
  elements.metrics.review.textContent = review;
  elements.metrics.needsWork.textContent = needsWork;
  elements.lastScan.textContent = `${cached ? "Cached" : "Last"} scan ${new Date(result.scannedAt).toLocaleString()}`;
  elements.progress.textContent = formatScanSummary(result, repositories.length, filteredRepositories.length);

  if (repositories.length === 0) {
    elements.rows.innerHTML = `<tr><td colspan="5" class="empty-state">${escapeHtml(formatEmptyRepositoryMessage(result))}</td></tr>`;
  } else if (filteredRepositories.length === 0) {
    elements.rows.innerHTML = `<tr><td colspan="5" class="empty-state">No repositories match these filters.</td></tr>`;
  } else {
    elements.rows.replaceChildren(...filteredRepositories.map(renderRepositoryRow));
  }

  renderRenovate(result.renovate);
  updateAdvancedScanButton();
  updateRefreshRenovateButton();
}

function renderCurrentScan() {
  if (currentScanResult) {
    renderScan(currentScanResult);
  }
}

function renderCurrentRenovate() {
  if (currentScanResult?.renovate) {
    renderRenovate(currentScanResult.renovate);
  }
}

async function refreshRenovatePullRequests() {
  if (!client || !currentScanResult?.repositories?.length) {
    return;
  }

  elements.refreshRenovateButton.disabled = true;
  elements.renovateSummary.textContent = "Refreshing Renovate pull requests...";

  try {
    const renovate = await client.getRenovatePullRequestsSafely(currentScanResult.owner, currentScanResult.repositories);
    currentScanResult = {
      ...currentScanResult,
      renovate
    };
    await saveScanSnapshot(currentScanResult.owner, currentScanResult);
    renderRenovate(renovate);
  } catch (error) {
    renderRenovate({ total: 0, auto: 0, manual: 0, unknown: 0, pullRequests: [], error: cleanError(error) });
  } finally {
    updateRefreshRenovateButton();
  }
}

function upsertRepository(result, repository) {
  const index = result.repositories.findIndex((item) => item.id === repository.id);

  if (index === -1) {
    result.repositories.push(repository);
    return;
  }

  result.repositories.splice(index, 1, repository);
}

function formatScanSummary(result, visibleCount, filteredCount = visibleCount) {
  if (!result.inventory) {
    return visibleCount ? formatFilteredCount(visibleCount, filteredCount) : "No repositories found.";
  }

  const failedCount = (result.repositories ?? []).filter((repo) => repo.checks?.some((check) => check.id === "scan")).length;
  const skippedCount = (result.repositories ?? []).filter((repo) => repo.checks?.some((check) => check.id === "rate-limit")).length;
  const failureText = failedCount ? ` ${failedCount} scan failed.` : "";
  const skippedText = skippedCount ? ` ${skippedCount} skipped by rate limit.` : "";
  const resetText = result.inventory.rateLimitResetAt ? ` Try again after ${new Date(result.inventory.rateLimitResetAt).toLocaleTimeString()}.` : "";

  return `Found ${result.inventory.totalCount} repositories; ${formatFilteredCount(visibleCount, filteredCount)}${result.includeArchived ? "" : `, excluding ${result.inventory.archivedCount} archived`}.${failureText}${skippedText}${resetText}`;
}

function formatFilteredCount(visibleCount, filteredCount) {
  return filteredCount === visibleCount ? `showing ${visibleCount}` : `showing ${filteredCount} of ${visibleCount}`;
}

function filterRepositories(repositories) {
  const status = elements.repoStatusFilter.value;
  const check = elements.repoCheckFilter.value;
  const lastPush = elements.repoPushFilter.value;
  const visibility = elements.repoVisibilityFilter.value;
  const query = elements.repoTextFilter.value.trim().toLowerCase();

  return repositories.filter((repo) => {
    const checks = getRepositoryCheckItems(repo);
    const matchesStatus = status === "all" || repo.status === status;
    const matchesCheck = check === "all" || checks.some((item) => item.label === check);
    const matchesLastPush = lastPush === "all" || pushBucket(repo.pushedAt) === lastPush;
    const matchesVisibility = visibility === "all" || (visibility === "private" ? Boolean(repo.private) : !repo.private);
    const searchable = [repo.name, repo.fullName, repo.description, relativeTime(repo.pushedAt), statusText(repo.status), ...checks.map((item) => item.label)].join("\n").toLowerCase();
    const matchesQuery = !query || searchable.includes(query);

    return matchesStatus && matchesCheck && matchesLastPush && matchesVisibility && matchesQuery;
  });
}

function updateCheckFilterOptions(repositories) {
  const selected = elements.repoCheckFilter.value;
  const labels = [...new Set(repositories.flatMap((repo) => getRepositoryCheckItems(repo).map((item) => item.label)))].sort((left, right) => left.localeCompare(right));

  elements.repoCheckFilter.replaceChildren(
    option("all", "All checks"),
    ...labels.map((label) => option(label, label))
  );
  elements.repoCheckFilter.value = labels.includes(selected) ? selected : "all";
}

function getRepositoryCheckItems(repo) {
  return [...(repo.checks ?? []), ...(repo.observations ?? []).filter((item) => item.id !== "last-push" && item.id !== "issues")];
}

function pushBucket(value, now = new Date()) {
  if (!value) {
    return "older";
  }

  const pushed = new Date(value);
  if (Number.isNaN(pushed.getTime())) {
    return "older";
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - ((startOfToday.getDay() + 6) % 7));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (pushed >= startOfToday) {
    return "today";
  }

  if (pushed >= startOfWeek) {
    return "week";
  }

  if (pushed >= startOfMonth) {
    return "month";
  }

  return "older";
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function formatEmptyRepositoryMessage(result) {
  if (result.inventory?.totalCount > 0 && !result.includeArchived && result.inventory.totalCount === result.inventory.archivedCount) {
    return "Only archived repositories were found. Use Include archived to scan them.";
  }

  if (result.inventory?.totalCount === 0) {
    return "The GitHub App installation returned zero repositories. Check repository access in the app installation settings.";
  }

  if (result.inventory?.totalCount > 0 && result.repositories?.length === 0) {
    return "Waiting for the first repository result...";
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
    <td>${escapeHtml(relativeTime(repo.pushedAt))}</td>
    <td><span class="status-pill ${repo.status}">${statusText(repo.status)}</span></td>
    <td><div class="check-list"></div></td>
  `;

  const checks = [...repo.checks, ...repo.observations];
  row.querySelector(".check-list").replaceChildren(...checks.map((check) => renderCheck(check, repo)));
  return row;
}

function renderCheck(check, repo) {
  const item = document.createElement("span");
  item.className = `check-pill ${check.status}`;
  if (check.id === "last-push" && repo?.pushedAt) {
    item.textContent = `Last push ${relativeTime(repo.pushedAt)}`;
  } else {
    item.textContent = check.label;
  }
  return item;
}

function renderRenovate(summary) {
  if (!summary) {
    elements.renovateSummary.textContent = "Renovate PRs refresh after the fast scan completes.";
    elements.renovateList.innerHTML = `<p class="empty-state">Open Renovate pull requests will appear after a scan.</p>`;
    updateRefreshRenovateButton();
    return;
  }

  if (summary.error) {
    elements.renovateSummary.textContent = `Renovate PR scan failed: ${summary.error}`;
    elements.renovateList.innerHTML = `<p class="empty-state">Repository scan results are still shown.</p>`;
    updateRefreshRenovateButton();
    return;
  }

  const filteredPullRequests = filterRenovatePullRequests(summary.pullRequests);
  const filterText = filteredPullRequests.length === summary.pullRequests.length ? "" : ` Showing ${filteredPullRequests.length} of ${summary.pullRequests.length}.`;
  const staleText = summary.stale ? ` ${summary.stale} stale auto-merge.` : "";
  elements.renovateSummary.textContent = `${summary.total} open. ${summary.auto} auto-merge, ${summary.manual} manual, ${summary.unknown} unknown.${staleText}${filterText}`;

  if (summary.pullRequests.length === 0) {
    elements.renovateList.innerHTML = `<p class="empty-state">No open Renovate pull requests found.</p>`;
    updateRefreshRenovateButton();
    return;
  }

  if (filteredPullRequests.length === 0) {
    elements.renovateList.innerHTML = `<p class="empty-state">No Renovate pull requests match these filters.</p>`;
    updateRefreshRenovateButton();
    return;
  }

  elements.renovateList.replaceChildren(...filteredPullRequests.map((pullRequest) => {
    const card = document.createElement("article");
    card.className = pullRequest.stale ? "renovate-card stale" : "renovate-card";
    const pillStatus = pullRequest.classification === "manual" ? "fail" : pullRequest.stale ? "warn" : pullRequest.classification === "auto" ? "pass" : "warn";
    const staleBadge = pullRequest.stale ? `<span class="status-pill warn">Open &gt;${appConfig.staleAutoMergeDays}d</span>` : "";
    card.innerHTML = `
      <span class="status-pill ${pillStatus}">${escapeHtml(pullRequest.classification)}</span>
      <div>
        <a href="${pullRequest.url}" target="_blank" rel="noreferrer">${escapeHtml(pullRequest.title)}</a>
        <span class="meta-text">${escapeHtml(pullRequest.repository)} #${pullRequest.number}</span>
      </div>
      ${staleBadge}
    `;
    return card;
  }));
  updateRefreshRenovateButton();
}

function filterRenovatePullRequests(pullRequests) {
  const mergeType = elements.renovateMergeFilter.value;
  const query = elements.renovateTextFilter.value.trim().toLowerCase();

  return pullRequests.filter((pullRequest) => {
    const matchesMergeType = mergeType === "all" || (mergeType === "actionable" ? (pullRequest.classification !== "auto" || pullRequest.stale) : pullRequest.classification === mergeType);
    const searchable = [pullRequest.title, pullRequest.repository, pullRequest.classification, String(pullRequest.number)].join("\n").toLowerCase();
    const matchesQuery = !query || searchable.includes(query);

    return matchesMergeType && matchesQuery;
  });
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

function selectTab(name) {
  elements.tabs.forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
  });

  elements.panels.forEach((panel) => {
    panel.hidden = panel.id !== `${name}-panel`;
  });
}

function renderRateLimit(rateLimit) {
  const resource = rateLimit.resource || "core";
  const previous = rateLimitBuckets.get(resource);
  const isNewWindow = !previous || (rateLimit.reset && previous.reset && rateLimit.reset > previous.reset);

  // Concurrent requests can return out of order, so only accept a higher
  // `remaining` when the rate-limit window has rolled over. Otherwise the
  // counter would visibly bounce up and down instead of monotonically
  // decreasing through the current window.
  if (!isNewWindow && previous && rateLimit.remaining > previous.remaining) {
    return;
  }

  rateLimitBuckets.set(resource, rateLimit);

  elements.rateLimit.textContent = [...rateLimitBuckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, bucket]) => `${name}: ${bucket.remaining} of ${bucket.limit} left`)
    .join(" · ");
}

function updateAdvancedScanButton() {
  if (activeScanKind === "advanced") {
    elements.advancedScanButton.disabled = false;
    return;
  }

  elements.advancedScanButton.disabled = Boolean(activeScanKind) || !client || !currentScanResult?.repositories?.length;
}

function updateRefreshRenovateButton() {
  elements.refreshRenovateButton.disabled = Boolean(activeScanKind) || !client || !currentScanResult?.repositories?.length;
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

async function registerServiceWorker() {
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

  const swVersion = await getServiceWorkerVersion();

  window.addEventListener("load", async () => {
    const registration = await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(swVersion)}`);
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    await registration.update();

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

async function getServiceWorkerVersion() {
  try {
    const response = await fetch("./build-meta.json", { cache: "no-store" });
    if (response.ok) {
      const meta = await response.json();
      return meta.shortSha || meta.sha || Date.now().toString();
    }
  } catch {
    // Fall back to a stable local version when build metadata is unavailable.
  }

  return "local";
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
