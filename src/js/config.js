const viteEnv = typeof import.meta.env === "object" ? import.meta.env : {};

export const appConfig = {
  appId: "3844070",
  clientId: "Iv23liPDQ7K7CdNoy4fz",
  authBrokerBaseUrl: viteEnv.VITE_GITHUB_AUTH_BROKER_URL ?? "",
  defaultOwner: "DevSecNinja",
  githubApiVersion: "2022-11-28",
  requestTimeoutMs: 20_000,
  scanConcurrency: 1,
  stalePushDays: 180,
  staleAutoMergeDays: 7
};

export const renovateStaleAutoMergeDays = appConfig.staleAutoMergeDays;

export const renovateCentralPatterns = [
  /github>DevSecNinja\/\.github/i,
  /github\.com\/DevSecNinja\/\.github/i,
  /DevSecNinja\/\.github\/\/.renovate/i
];

export const renovateMergeSignals = {
  autoMerge: [
    /automerge\s*:\s*enabled/i,
    /automerge\s+enabled/i,
    /automerge\W+enabled/i,
    /🚦\s*automerge\s*:\s*enabled/i,
    /auto-?merge\s+enabled/i,
    /merge:\s*auto/i,
    /this pr will be automerged/i,
    /renovate will automatically merge/i
  ],
  manualMerge: [
    /automerge\s*:\s*disabled/i,
    /auto-?merge\s+disabled/i,
    /manual merge/i,
    /requires manual/i,
    /please merge this manually/i
  ]
};
