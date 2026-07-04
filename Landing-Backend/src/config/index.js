/**
 * Backend configuration entry point.
 * Environment values: {@link ./env.js}
 */

export { getEnv, buildEnv, initConfig, getPublicEnv, __resetEnvForTests, env } from "./env.js";
export {
  collectEnvValidationErrors,
  validateEnvSource,
  firebaseServiceAccountSchema,
  parseFirebaseServiceAccountJson,
} from "./env-schema.js";
export { toPublicEnv } from "./env-public.js";

export { getDb, getFirebaseStatus, __setTestDb, __resetTestDb } from "./firebase.js";
