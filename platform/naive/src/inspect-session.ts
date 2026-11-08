// Dump every event of a session, full data, so we can see what flipped a flag.
//   npm run inspect -- ses_...
import { naive } from "./client.js";
import { withRetry } from "./retry.js";

const id = process.argv[2];
if (!id?.startsWith("ses_")) { console.error("usage: npm run inspect -- ses_<id>"); process.exit(1); }

const s = await withRetry(() => naive.sessions.get(id), "session");
console.log(JSON.stringify({ id: s.id, status: s.status, stop_reason: s.stop_reason, pending: (s as { pending_actions?: unknown }).pending_actions }, null, 2));

let after = 0;
for (;;) {
  const ev = await withRetry(() => naive.sessions.events(id, { after_seq: after, limit: 100 }), "events");
  for (const e of ev.data) {
    after = Math.max(after, e.seq);
    if (e.type.startsWith("span.") || e.type === "message.delta") continue;
    console.log(`\n#${e.seq} ${e.type} ${e.created_at}`);
    console.log(JSON.stringify(e.data, null, 2));
  }
  if (!ev.has_more) break;
}
