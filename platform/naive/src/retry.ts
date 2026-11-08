// Naïve returns 429 "the service is at capacity" under hackathon load. Retry those with backoff
// instead of crashing a watcher; everything else is rethrown.
export async function withRetry<T>(fn: () => Promise<T>, label = "request", attempts = 8): Promise<T> {
  let wait = 3000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status !== 429 && status !== 503) throw e;
      if (i >= attempts) throw e;
      process.stdout.write(`  (${label}: ${status}, retrying in ${wait / 1000}s)\n`);
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 30_000);
    }
  }
}
