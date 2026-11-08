import { open, readFile, unlink, writeFile, truncate, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/** Refuse concurrent writers. A crashed process's lock can be recovered on restart. */
export async function lockOutput(path: string): Promise<() => Promise<void>> {
  const token = randomUUID(), lock = `${path}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lock, "wx");
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); } finally { await handle.close(); }
      return async () => {
        const current = JSON.parse(await readFile(lock, "utf8")) as { token: string };
        if (current.token === token) await unlink(lock);
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const old = JSON.parse(await readFile(lock, "utf8")) as { pid: number };
      if (!Number.isInteger(old.pid) || old.pid < 1) throw new Error("invalid production output lock; inspect it before retrying");
      let alive = true;
      try { process.kill(old.pid, 0); } catch (err) { if ((err as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
      if (alive) throw new Error(`another production process (${old.pid}) owns this checkpoint`);
      await unlink(lock);
    }
  }
  throw new Error("could not acquire production checkpoint lock");
}

/** Preserve and remove only a torn final JSONL line from a crash. Interior corruption is fatal. */
export async function readCheckpoint(path: string): Promise<string> {
  let data: string;
  try { data = await readFile(path, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return ""; throw e; }
  if (!data || data.endsWith("\n")) return data;
  const at = data.lastIndexOf("\n") + 1;
  try { JSON.parse(data.slice(at)); }
  catch {
    await writeFile(`${path}.partial-${Date.now()}`, data.slice(at), { flag: "wx" });
    await truncate(path, Buffer.byteLength(data.slice(0, at)));
    return data.slice(0, at);
  }
  await appendFile(path, "\n");
  return data + "\n";
}
