import { requireUser } from "@/lib/user";

// Example of a route that needs one of the permissions Central gave the person in this application.
export async function GET(request: Request) {
  const user = await requireUser(request, "things.read");
  if (user instanceof Response) return user;
  return Response.json({ things: [] });
}
