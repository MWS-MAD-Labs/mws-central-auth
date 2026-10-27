export { AccessDefinitionError, can, canAny, definePermissions, type PermissionInput, type PermissionSet } from "./permissions.js";
export {
  createAccessResolver,
  type AccessDenial,
  type AccessResolver,
  type AccessResolverOptions,
  type AccessResult,
  type EntitlementLike,
} from "./resolver.js";
export type { ManifestEntry } from "../conformance/types.js";
