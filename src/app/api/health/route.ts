/** Process health only: frequent platform probes must not consume Redis/Blob quota. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, database: process.env.ARENA_DATABASE_MODE??"redis", databaseMigration:1,
    commit:process.env.RENDER_GIT_COMMIT??process.env.VERCEL_GIT_COMMIT_SHA??null }, {
    headers: { "Cache-Control": "no-store" },
  });
}
