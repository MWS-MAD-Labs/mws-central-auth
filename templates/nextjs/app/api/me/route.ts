import { hub } from "@/lib/hub";
import { requireUser } from "@/lib/user";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const session = hub();
  return Response.json({ ...user, hub: { homeUrl: session.homeUrl(), refreshUrl: session.refreshUrl() } });
}
