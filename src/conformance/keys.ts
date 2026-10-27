// AS-3. Keep this in step with the check Central applies to new keys (server/src/utils/permission-key.ts there).
export const STANDARD_PERMISSION_KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,2}$/;
export const MAX_STANDARD_KEY_LENGTH = 64;

export function isStandardPermissionKey(key: string): boolean {
  return key.length <= MAX_STANDARD_KEY_LENGTH && STANDARD_PERMISSION_KEY.test(key);
}
