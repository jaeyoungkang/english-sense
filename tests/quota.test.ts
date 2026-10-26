import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { DailyQuota } from "../lib/server/quota";

function setup() {
  const db = new DatabaseSync(":memory:");
  let alarm: number | null = null;
  let injectFailure = false;
  const storage = {
    sql: {
      exec<T extends Record<string, unknown>>(query: string, ...bindings: (string | number)[]) {
        if (injectFailure && query.startsWith("INSERT") && bindings[0] !== "global") throw new Error("simulated second-write failure");
        const rows = db.prepare(query).all(...bindings) as T[];
        return { toArray: () => rows };
      },
    },
    transactionSync<T>(callback: () => T): T {
      db.exec("BEGIN TRANSACTION");
      try {
        const result = callback();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async getAlarm() { return alarm; },
    async setAlarm(time: number) { alarm = time; },
    async deleteAll() { db.exec("DROP TABLE IF EXISTS quota"); alarm = null; },
  };
  // Cloudflare waits for this initialization before delivering any request.
  let initialized: Promise<unknown>;
  const context = { storage, blockConcurrencyWhile<T>(callback: () => Promise<T>) { const promise = callback(); initialized = promise; return promise; } };
  const create = async () => { const instance = new DailyQuota(context, {}); await initialized; return instance; };
  return { db, storage, create, alarm: () => alarm, failSecondWrite: () => { injectFailure = true; } };
}

function request(ipHash = "a".repeat(64), perIpLimit = 3, globalLimit = 5): Request {
  return new Request("https://quota.internal/take", { method: "POST", body: JSON.stringify({ day: new Date().toISOString().slice(0, 10), ipHash, perIpLimit, globalLimit }) });
}

test("concurrent requests cannot exceed the per-IP or global limit", async () => {
  const fixture = setup();
  const quota = await fixture.create();
  const first = await Promise.all(Array.from({ length: 30 }, () => quota.fetch(request())));
  assert.equal(first.filter((response) => response.status === 200).length, 3);
  assert.equal(first.filter((response) => response.status === 429).length, 27);
  assert.deepEqual(await first.find((response) => response.status === 429)!.json(), { allowed: false, reason: "ip" });
  const second = await Promise.all(Array.from({ length: 30 }, (_, index) => quota.fetch(request(index.toString(16).padStart(64, "0")))));
  assert.equal(second.filter((response) => response.status === 200).length, 2);
  assert.equal(second.filter((response) => response.status === 429).length, 28);
  assert.deepEqual(await second.find((response) => response.status === 429)!.json(), { allowed: false, reason: "global" });
  assert.equal(fixture.db.prepare("SELECT used FROM quota WHERE key = 'global'").get()!.used, 5);
  fixture.db.close();
});

test("a new isolate retains counters in the same SQLite storage", async () => {
  const fixture = setup();
  assert.equal((await (await fixture.create()).fetch(request("b".repeat(64), 1))).status, 200);
  assert.equal((await (await fixture.create()).fetch(request("b".repeat(64), 1))).status, 429);
  fixture.db.close();
});

test("both counters roll back together if the second SQL write fails", async () => {
  const fixture = setup();
  const quota = await fixture.create();
  fixture.failSecondWrite();
  await assert.rejects(quota.fetch(request()), /simulated second-write failure/);
  assert.equal(fixture.db.prepare("SELECT count(*) AS count FROM quota").get()!.count, 0);
  fixture.db.close();
});

test("only hashes are stored, invalid internal requests consume nothing, and alarms delete expired data", async () => {
  const fixture = setup();
  const quota = await fixture.create();
  assert.ok(fixture.alarm()! > Date.now() + 47 * 60 * 60 * 1000);
  for (const ipHash of ["203.0.113.7", "short", "g".repeat(64)]) assert.equal((await quota.fetch(request(ipHash))).status, 400);
  assert.equal(fixture.db.prepare("SELECT count(*) AS count FROM quota").get()!.count, 0);
  assert.equal((await quota.fetch(request())).status, 200);
  const rows = fixture.db.prepare("SELECT key FROM quota").all();
  assert.deepEqual(rows.map((row) => row.key).sort(), ["a".repeat(64), "global"]);
  await quota.alarm();
  assert.equal(fixture.alarm(), null);
  assert.equal(fixture.db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'quota'").get()!.count, 0);
  fixture.db.close();
});
