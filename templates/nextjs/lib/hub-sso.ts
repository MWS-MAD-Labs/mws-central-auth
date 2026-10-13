import { createHubSso } from "mws-central-auth/server";

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Everything about the Hub sign-in and sign-out flow comes from the shared package.
export function hubSso() {
  return createHubSso({
    hubBaseUrl: required("HUB_BASE_URL"),
    appId: required("HUB_SSO_APP_ID"),
    internalSecret: required("HUB_INTERNAL_SECRET"),
  });
}
