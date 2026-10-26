interface SqlCursor { toArray(): Record<string, unknown>[] }
interface QuotaStorage {
  sql: { exec(query: string, ...bindings: (string | number)[]): SqlCursor };
  transactionSync<T>(callback: () => T): T;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  deleteAll(): Promise<void>;
}
interface QuotaContext {
  storage: QuotaStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface QuotaRequest { day: string; ipHash: string; perIpLimit: number; globalLimit: number }
type QuotaResult = { allowed: true } | { allowed: false; reason: "global" | "ip" };

export class DailyQuota {
  private storage: QuotaStorage;

  constructor(context: QuotaContext, _env: unknown) {
    this.storage = context.storage;
    context.blockConcurrencyWhile(async () => {
      this.storage.sql.exec("CREATE TABLE IF NOT EXISTS quota (key TEXT PRIMARY KEY, used INTEGER NOT NULL)");
      if (await this.storage.getAlarm() === null) await this.storage.setAlarm(Date.now() + 48 * 60 * 60 * 1000);
    });
  }

  private take(input: QuotaRequest): QuotaResult {
    return this.storage.transactionSync(() => {
      const total = Number(this.storage.sql.exec("SELECT used FROM quota WHERE key = ?", "global").toArray()[0]?.used ?? 0);
      const ip = Number(this.storage.sql.exec("SELECT used FROM quota WHERE key = ?", input.ipHash).toArray()[0]?.used ?? 0);
      if (total >= input.globalLimit) return { allowed: false, reason: "global" };
      if (ip >= input.perIpLimit) return { allowed: false, reason: "ip" };
      this.storage.sql.exec("INSERT INTO quota (key, used) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET used = used + 1", "global");
      this.storage.sql.exec("INSERT INTO quota (key, used) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET used = used + 1", input.ipHash);
      return { allowed: true };
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    let input: unknown;
    try { input = await request.json(); } catch { return new Response(null, { status: 400 }); }
    if (!input || typeof input !== "object") return new Response(null, { status: 400 });
    const value = input as QuotaRequest;
    if (value.day !== new Date().toISOString().slice(0, 10) || typeof value.ipHash !== "string" || !/^[a-f0-9]{64}$/.test(value.ipHash) || !Number.isSafeInteger(value.perIpLimit) || value.perIpLimit < 1 || !Number.isSafeInteger(value.globalLimit) || value.globalLimit < 1) return new Response(null, { status: 400 });
    const result = this.take(value);
    return Response.json(result, { status: result.allowed ? 200 : 429, headers: { "Cache-Control": "no-store" } });
  }

  async alarm(): Promise<void> {
    await this.storage.deleteAll();
  }
}
