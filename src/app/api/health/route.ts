/** Process health only: frequent platform probes must not consume Redis/Blob quota. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
