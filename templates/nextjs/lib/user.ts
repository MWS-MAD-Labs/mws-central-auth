import { accessFor } from "./access";
import { hub } from "./hub";

export interface SignedIn {
  id: string;
  email: string;
  role: string;
  permissions: string[];
  expiresIn: number;
}

// For route handlers that need a signed-in person: the person, or the Response to send back.
// `permission` is a Central permission key.
export async function requireUser(request: Request, permission?: string): Promise<SignedIn | Response> {
  const claims = await hub().fromCookieHeader(request.headers.get("cookie"));
  if (!claims) return Response.json({ error: "Not signed in" }, { status: 401 });
  let access;
  try {
    access = await accessFor(claims.sub);
  } catch {
    return Response.json({ error: "Try again shortly" }, { status: 503 });
  }
  if (!access) return Response.json({ error: "No access to this application" }, { status: 403 });
  if (permission && !access.permissions.includes(permission)) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  return {
    id: claims.sub,
    email: claims.email,
    ...access,
    expiresIn: Math.max(claims.exp - Math.floor(Date.now() / 1000), 0),
  };
}
