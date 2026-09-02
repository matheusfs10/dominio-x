export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", service: "web", time: new Date().toISOString() });
}
