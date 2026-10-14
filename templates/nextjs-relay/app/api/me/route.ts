import { requireUser } from "@/lib/session";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id, email, role, permissions } = user;
  return Response.json({ id, email, role, permissions });
}
