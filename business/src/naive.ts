import { createClient } from "@usenaive-sdk/managed-agents";
import type { Lead, PipelineStage } from "./types.js";

/**
 * Everything business ops does through the Naïve SDK: the CRM (the agents' source of truth for
 * studios) and starting agent sessions (for example, waking the Sales Reader on a reply).
 * Signatures checked against @usenaive-sdk/managed-agents 0.12 on Nov 7, 2026.
 */
export type NaiveClient = ReturnType<typeof createClient>;

export function naiveClient(apiKey: string, baseUrl: string): NaiveClient {
  return createClient({ apiKey, baseUrl });
}

/** Naïve CRM stages are lead | talking | proposal | won | lost. Ours are finer-grained. */
export function toCrmStage(stage: PipelineStage): "lead" | "talking" | "proposal" | "won" | "lost" {
  switch (stage) {
    case "found":
    case "sample_made":
      return "lead";
    case "emailed":
    case "replied":
      return "talking";
    case "pilot_offered":
      return "proposal";
    case "pilot_paid":
    case "delivered":
      return "won";
    case "lost":
    case "opted_out":
      return "lost";
  }
}

/** Creates or updates the CRM contact for a lead and adds a timeline note. Returns the contact id. */
export async function syncLeadToCrm(client: NaiveClient, lead: Lead, note: string, valueMicroUsd?: number): Promise<string> {
  const stage = toCrmStage(lead.stage);
  let id = lead.crmContactId;
  if (!id) {
    const created = await client.crm.contacts.create({
      name: lead.contactName ?? `${lead.company} team`,
      company: lead.company,
      email: lead.email,
      stage,
      source: lead.source,
      next_step: lead.stage === "found" ? "make a sample pack" : null,
      value_micro_usd: valueMicroUsd ?? null,
    });
    id = created.id;
  } else {
    await client.crm.contacts.update(id, { stage, ...(valueMicroUsd !== undefined ? { value_micro_usd: valueMicroUsd } : {}) });
  }
  await client.crm.activity.create({ contact_id: id, kind: "note", body: note });
  return id;
}

/** Starts a session on an agent with one message, e.g. the Sales Reader with a reply to read. */
export async function startSession(client: NaiveClient, agentId: string, message: string): Promise<string> {
  const session = await client.sessions.create({ agent_id: agentId, message });
  return session.id;
}
