import { appConfig } from "./config.js";

const settingsKey = "github-compliance:settings";
const sessionAuthKey = "github-compliance:session-auth";
const localAuthKey = "github-compliance:local-auth";
const databaseName = "github-compliance";
const databaseVersion = 1;

export function loadSettings() {
  return {
    theme: "auto",
    owner: appConfig.defaultOwner,
    includeArchived: false,
    rememberDevice: false,
    ...readJson(localStorage.getItem(settingsKey))
  };
}

export function saveSettings(settings) {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
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
