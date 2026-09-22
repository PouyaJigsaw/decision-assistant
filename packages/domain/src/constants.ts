export const CONFIDENCE_THRESHOLD = 0.75;
export const POLICY_VERSION = 1 as const;
export const TRIAL_SUCCESS_CAP = 3;
export const JEV_PRICE = { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0 } as const;
export const CHOICE_OPTIONS = ["match", "mismatch", "no_evidence", "contradictory"] as const;
export const SENIORITY_LEVELS = ["below", "aligned", "above", "unclear"] as const;
export const JEV_REQUEST_MODEL = "jev-latest" as const;
export const VERSIONED_JEV_MODEL = /^jev-\d+\.\d+\.\d+$/;
