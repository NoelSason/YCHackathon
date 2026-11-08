import { describe, expect, it } from "vitest";
import { withDbRetry } from "../src/store.js";

describe("withDbRetry", () => {
  it("retries a network failure and returns the result", async () => {
    let calls = 0;
    const r = await withDbRetry(async () => {
      if (++calls < 3) throw new Error("Error connecting to database: TypeError: fetch failed");
      return "ok";
    }, [0, 0, 0]);
    expect(r).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the last delay", async () => {
    let calls = 0;
    await expect(withDbRetry(async () => { calls++; throw new Error("fetch failed"); }, [0])).rejects.toThrow("fetch failed");
    expect(calls).toBe(2);
  });

  it("doesn't retry a query error", async () => {
    let calls = 0;
    await expect(withDbRetry(async () => { calls++; throw new Error('column "x" does not exist'); }, [0, 0])).rejects.toThrow("does not exist");
    expect(calls).toBe(1);
  });
});
