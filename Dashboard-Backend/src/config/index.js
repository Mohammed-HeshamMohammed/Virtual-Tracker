/**
 * Backend configuration entry point.
 * Environment values: {@link ./env.js}
 */

export { getEnv, buildEnv, initConfig, getPublicEnv, __resetEnvForTests, env } from "./env.js";
export {
  collectEnvValidationErrors,
  validateEnv,
  validateEnvSource,
  firebaseWebConfigSchema,
  firebaseServiceAccountSchema,
  parseFirebaseWebConfigJson,
  parseFirebaseServiceAccountJson,
} from "./env-schema.js";
export { toPublicEnv } from "./env-public.js";

export {
  readFirebaseWebConfigFromEnv,
  getDb,
  getAuthAdmin,
  getFirebaseStatus,
  resolveStorageBucketName,
  resolveStorageBucketCandidates,
  getStorageBucket,
  getStorageBucketAsync,
  formatStorageSetupError,
  __setTestDb,
  __setTestAuth,
  __resetTestDb,
} from "./firebase.js";

export {
  getActivityCaptureMode,
  isActivityScreenshotsEnabled,
  isWebActivityCaptureEnabled,
  isTaskScreenshotCaptureEnabled,
  isDesktopAgentEventIngestEnabled,
} from "./activity.js";

export { getActivitySessionStaleMs } from "./activity-session.js";

export {
  PRESENCE_ONLINE_MS,
  PRESENCE_IDLE_MS,
  PRESENCE_ACTIVITY_WINDOW_MS,
  PRESENCE_SIGNAL_MIN_INTERVAL_MS,
} from "./presence.js";
