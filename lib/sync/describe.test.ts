import { describe, expect, it } from "vitest";

import { describeSync } from "./describe";
import type { SyncSnapshot } from "./types";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const base: SyncSnapshot & { online: boolean } = {
  status: "idle",
  pending: 0,
  lastError: null,
  lastSyncedAt: "2026-11-16T11:57:00Z",
  online: true,
};
const say = (over: Partial<typeof base>) => describeSync({ ...base, ...over }, NOW);

describe("describeSync", () => {
  it("says Synced only when nothing is pending and nothing failed", () => {
    expect(say({})).toMatchObject({ tone: "ok", label: "Synced" });
    expect(say({}).detail).toContain("3 min ago");
  });

  it("never says Synced while changes are waiting", () => {
    expect(say({ pending: 2 }).label).not.toBe("Synced");
    expect(say({ pending: 2 }).tone).toBe("busy");
  });

  it("offline wins over everything, and counts what is waiting", () => {
    const v = say({ online: false, pending: 3, status: "error", lastError: "x" });
    expect(v).toMatchObject({ tone: "warn", label: "Offline · 3" });
    expect(v.detail).toContain("3 changes waiting");
    expect(say({ online: false }).label).toBe("Offline");
  });

  it("distinguishes an unreachable cloud from an offline device", () => {
    expect(say({ status: "offline", pending: 1 })).toMatchObject({ tone: "warn", label: "Can't reach cloud · 1" });
  });

  it("an expired session tells the user to sign in again", () => {
    const v = say({ status: "error", lastError: "JWT expired", pending: 1 });
    expect(v.tone).toBe("bad");
    expect(v.detail).toMatch(/sign in again/i);
    expect(v.detail).toContain("1 change waiting");
  });

  it("any other failure promises a retry, not a sign-in", () => {
    const v = say({ status: "error", lastError: "push note n1: violates check constraint" });
    expect(v.tone).toBe("bad");
    expect(v.detail).not.toMatch(/sign in/i);
    expect(v.detail).toMatch(/retried/);
  });

  it("every state reassures that work is on the device when it is not synced", () => {
    for (const v of [say({ online: false }), say({ status: "offline" }), say({ status: "error", lastError: "x" })]) {
      expect(v.detail).toMatch(/saved on this device/);
    }
  });

  it("omits the time when there has never been a sync", () => {
    expect(say({ lastSyncedAt: null }).detail).toBe("All changes are synced to the cloud.");
  });
});
