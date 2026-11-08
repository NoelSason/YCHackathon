/**
 * One OpenAI chat call with a strict JSON schema (structured output), the same request shape as
 * research/verify.ts. Returns the parsed object, or an error string. The error never includes the
 * provider's message text, which can echo part of the key.
 */
export interface ChatJsonOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const isReasoningModel = (model: string): boolean => /^(gpt-5|gpt-6|o\d)/.test(model);

export async function chatJson(
  opts: ChatJsonOptions,
  args: { system: string; user: string; schemaName: string; schema: Record<string, unknown>; maxTokens?: number },
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const body = {
    model: opts.model,
    ...(isReasoningModel(opts.model) ? { reasoning_effort: "low" } : { temperature: 0 }),
    max_completion_tokens: args.maxTokens ?? 4000,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    response_format: { type: "json_schema", json_schema: { name: args.schemaName, strict: true, schema: args.schema } },
  };
  let last = "unknown error";
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await (opts.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      last = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "network error";
      continue;
    }
    if (!res.ok) {
      last = `HTTP ${res.status}`;
      if (res.status === 429 || res.status >= 500) continue;
      return { ok: false, error: last };
    }
    const json = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> } | null;
    const choice = json?.choices?.[0];
    if (choice?.finish_reason === "length") return { ok: false, error: "answer was cut off" };
    if (typeof choice?.message?.content !== "string") return { ok: false, error: "empty answer" };
    try {
      return { ok: true, value: JSON.parse(choice.message.content) };
    } catch {
      return { ok: false, error: "answer wasn't JSON" };
    }
  }
  return { ok: false, error: last };
}
