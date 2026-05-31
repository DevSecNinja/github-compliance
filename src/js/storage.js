import { appConfig } from "./config.js";

const settingsKey = "github-compliance:settings";
const sessionAuthKey = "github-compliance:session-auth";
const localAuthKey = "github-compliance:local-auth";
const databaseName = "github-compliance";
const databaseVersion = 1;

export function loadSettings() {
  const stored = readJson(localStorage.getItem(settingsKey)) ?? {};

  return {
    theme: "auto",
    owner: appConfig.defaultOwner,
    includeArchived: false,
    rememberDevice: false,
    ...stored,
    customRepositories: normalizeCustomRepositories(stored.customRepositories)
  };
}

export function saveSettings(settings) {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

// Accepts a repository reference such as "owner/repo", a full GitHub URL, or a
// "git@github.com:owner/repo.git" remote and returns the canonical "owner/repo"
// form. Returns null when the value does not look like a repository reference.
export function parseRepositoryReference(value) {
  if (typeof value !== "string") {
    return null;
  }

  let candidate = value.trim();

  if (!candidate) {
    return null;
  }

  candidate = candidate
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  const match = candidate.match(/^([A-Za-z0-9-._]+)\/([A-Za-z0-9-._]+)/);

  if (!match) {
    return null;
  }

  const [, owner, repo] = match;

  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    return null;
  }

  return `${owner}/${repo}`;
}

function normalizeCustomRepositories(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const entry of value) {
    const fullName = parseRepositoryReference(entry);
    const key = fullName?.toLowerCase();

    if (fullName && !seen.has(key)) {
      seen.add(key);
      result.push(fullName);
    }
  }

  return result;
}

export function saveAuthState(authState, rememberDevice) {
  const serialized = JSON.stringify(authState);
  sessionStorage.setItem(sessionAuthKey, serialized);

  if (rememberDevice) {
    localStorage.setItem(localAuthKey, serialized);
  } else {
    localStorage.removeItem(localAuthKey);
  }
}

export function loadAuthState() {
  return readJson(sessionStorage.getItem(sessionAuthKey)) ?? readJson(localStorage.getItem(localAuthKey));
}

export function clearAuthState() {
  sessionStorage.removeItem(sessionAuthKey);
  localStorage.removeItem(localAuthKey);
}

export async function saveScanSnapshot(owner, snapshot) {
  const database = await openDatabase();
  await put(database, "scans", { owner, ...snapshot });
}

export async function loadScanSnapshot(owner) {
  const database = await openDatabase();
  return get(database, "scans", owner);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("scans")) {
        database.createObjectStore("scans", { keyPath: "owner" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(database, storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function get(database, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

function readJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
