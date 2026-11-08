import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { SqlAgencyStore } from "../src/agency/store.js";
import type { Query } from "../src/store.js";

// The agency tables in an in-process Postgres: the schema runs twice, saves upsert, and a message is claimed once.
describe("SqlAgencyStore", () => {
  it("saves, finds, and claims each inbound message once", async () => {
    const db = await PGlite.create({ extensions: { pgcrypto } });
    const q: Query = async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
    const a = new SqlAgencyStore(q);
    await a.ensure();
    await new SqlAgencyStore(q).ensure(); // safe to re-run
    const lead = "11111111-1111-4111-8111-111111111111";
    await a.save({ leadId: null, slug: "acct", domain: "acct.example", company: "Acct", about: null, services: null, website: null, contactEmail: null, internalTest: false, status: "skipped", detail: "not games" });
    const r = await a.save({ leadId: lead, slug: "pixel", domain: "pixel.example", company: "Pixel", about: "makes games", services: null, website: null, contactEmail: "hello@pixel.example", internalTest: false, status: "found", detail: null });
    const again = await a.save({ ...r, status: "emailed" });
    expect(again.status).toBe("emailed");
    expect((await a.forLead(lead))?.slug).toBe("pixel");
    expect((await a.bySlug("acct"))?.detail).toBe("not games");
    expect((await a.byDomain("pixel.example"))?.company).toBe("Pixel");
    const restart = await a.save({ ...again, startedAt: "2030-01-01T00:00:00.000Z" });
    expect(restart.startedAt).toBe("2030-01-01T00:00:00.000Z");

    expect(await a.claimTurn(lead, "<m1>", "how much?")).toBe(true);
    expect(await a.claimTurn(lead, "<m1>", "how much?")).toBe(false);
    await a.finishTurn("<m1>", { action: "answer", topic: "pricing", status: "sent", replyText: "Hi" });
    const turns = await a.turns(lead);
    expect(turns).toMatchObject([{ inboundText: "how much?", status: "sent", action: "answer" }]);
    expect(await a.countTurnsSince("2000-01-01T00:00:00Z", ["sent"])).toBe(1);
  });
});
