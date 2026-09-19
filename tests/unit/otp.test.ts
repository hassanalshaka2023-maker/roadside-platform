import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OTP lifecycle tests.
 *
 * Prisma and the SMS gateway are replaced with in-memory fakes so the real
 * rules - expiry, attempt limits, resend cooldown, single consumption - are
 * exercised without a database. Time is driven by fake timers, so nothing
 * sleeps.
 */

interface OtpRow {
  id: string;
  phone: string;
  codeHash: string;
  purpose: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  ipHash: string | null;
  seq: number;
}

const rows: OtpRow[] = [];
let seq = 0;

interface Where {
  id?: string;
  phone?: string;
  purpose?: string;
  consumedAt?: null;
}

function matches(row: OtpRow, where: Where): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.phone !== undefined && row.phone !== where.phone) return false;
  if (where.purpose !== undefined && row.purpose !== where.purpose) return false;
  if (where.consumedAt === null && row.consumedAt !== null) return false;
  return true;
}

/** Newest first, with the insertion counter breaking same-millisecond ties. */
function newestFirst(a: OtpRow, b: OtpRow): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq;
}

const prismaFake = {
  otpCode: {
    findFirst: async ({ where }: { where: Where }) =>
      rows.filter((row) => matches(row, where)).sort(newestFirst)[0] ?? null,

    create: async ({ data }: { data: Partial<OtpRow> }) => {
      const row: OtpRow = {
        id: `otp-${seq}`,
        phone: data.phone!,
        codeHash: data.codeHash!,
        purpose: data.purpose!,
        attempts: 0,
        expiresAt: data.expiresAt!,
        consumedAt: null,
        createdAt: new Date(),
        ipHash: data.ipHash ?? null,
        seq: seq++,
      };
      rows.push(row);
      return row;
    },

    update: async ({ where, data }: { where: Where; data: Partial<OtpRow> }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },

    updateMany: async ({ where, data }: { where: Where; data: Partial<OtpRow> }) => {
      const matched = rows.filter((row) => matches(row, where));
      for (const row of matched) Object.assign(row, data);
      return { count: matched.length };
    },

    deleteMany: async () => ({ count: 0 }),
  },
  $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
};

const sentMessages: Array<{ to: string; body: string }> = [];

vi.mock("@/lib/db", () => ({ prisma: prismaFake }));
vi.mock("@/lib/sms", () => ({
  smsProvider: {
    name: "test",
    send: async (message: { to: string; body: string }) => {
      sentMessages.push(message);
    },
  },
}));

const { requestOtp, verifyOtp } = await import("@/lib/auth/otp");
const { rateLimiter } = await import("@/lib/rate-limit");
const { MemoryRateLimiter } = await import("@/lib/rate-limit/memory");

const PHONE = "+963938503705";
const START = new Date("2026-01-01T10:00:00Z");

/** Captures the code that was handed to the message renderer. */
let lastCode = "";
const render = (code: string) => {
  lastCode = code;
  return `code: ${code}`;
};

async function issue() {
  return requestOtp(PHONE, "LOGIN", render, { ip: "203.0.113.5" });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);

  rows.length = 0;
  sentMessages.length = 0;
  seq = 0;
  lastCode = "";

  // The limiter is a module-level singleton; without this, counts leak
  // between tests.
  if (rateLimiter instanceof MemoryRateLimiter) rateLimiter.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestOtp", () => {
  it("issues a code and sends exactly one message", async () => {
    const result = await issue();

    expect(result.ok).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].to).toBe(PHONE);
  });

  it("generates a 6-digit numeric code", async () => {
    await issue();
    expect(lastCode).toMatch(/^\d{6}$/);
  });

  it("stores a hash, never the code itself", async () => {
    await issue();

    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).not.toBe(lastCode);
    // A hex HMAC-SHA256 digest.
    expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].codeHash).not.toContain(lastCode);
  });

  it("sets the expiry five minutes out", async () => {
    const result = await issue();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiresAt.toISOString()).toBe("2026-01-01T10:05:00.000Z");
  });

  it("produces different codes on successive issues", async () => {
    await issue();
    const first = lastCode;

    vi.advanceTimersByTime(60_000);
    await issue();

    // Not a strict guarantee for a 6-digit code, but a collision here would
    // be a one-in-a-million coincidence and worth investigating.
    expect(lastCode).not.toBe(first);
  });
});

describe("resend cooldown", () => {
  it("refuses a resend inside the cooldown", async () => {
    await issue();
    vi.advanceTimersByTime(30_000);

    const result = await issue();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("COOLDOWN");
    expect(result.retryAfterSeconds).toBe(30);
  });

  it("allows a resend once the cooldown has passed", async () => {
    await issue();
    vi.advanceTimersByTime(60_000);

    expect((await issue()).ok).toBe(true);
  });

  it("invalidates the previous code when a new one is issued", async () => {
    await issue();
    const firstCode = lastCode;

    vi.advanceTimersByTime(60_000);
    await issue();

    const result = await verifyOtp(PHONE, firstCode, "LOGIN");
    expect(result.ok).toBe(false);
  });
});

describe("hourly limits", () => {
  it("stops after the configured number of codes per phone", async () => {
    // Five allowed per hour; step past the cooldown between each.
    for (let i = 0; i < 5; i++) {
      expect((await issue()).ok).toBe(true);
      vi.advanceTimersByTime(61_000);
    }

    const sixth = await issue();
    expect(sixth.ok).toBe(false);
    if (sixth.ok) return;
    expect(sixth.reason).toBe("RATE_LIMITED_PHONE");
  });
});

describe("verifyOtp", () => {
  it("accepts the correct code", async () => {
    await issue();
    expect(await verifyOtp(PHONE, lastCode, "LOGIN")).toEqual({ ok: true });
  });

  it("consumes the code, so it cannot be replayed", async () => {
    await issue();
    const code = lastCode;

    expect((await verifyOtp(PHONE, code, "LOGIN")).ok).toBe(true);

    const replay = await verifyOtp(PHONE, code, "LOGIN");
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe("NO_ACTIVE_CODE");
  });

  it("rejects a wrong code and counts down the attempts", async () => {
    await issue();

    const result = await verifyOtp(PHONE, "000000", "LOGIN");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_CODE");
    expect(result.attemptsLeft).toBe(4);
  });

  it("kills the code after five wrong attempts", async () => {
    await issue();
    const realCode = lastCode;

    for (let i = 0; i < 4; i++) {
      await verifyOtp(PHONE, "000000", "LOGIN");
    }

    const fifth = await verifyOtp(PHONE, "000000", "LOGIN");
    expect(fifth.ok).toBe(false);
    if (fifth.ok) return;
    expect(fifth.reason).toBe("TOO_MANY_ATTEMPTS");

    // Even the correct code no longer works: the record is burned.
    const afterwards = await verifyOtp(PHONE, realCode, "LOGIN");
    expect(afterwards.ok).toBe(false);
  });

  it("rejects an expired code", async () => {
    await issue();
    vi.advanceTimersByTime(5 * 60_000 + 1000);

    const result = await verifyOtp(PHONE, lastCode, "LOGIN");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("EXPIRED");
  });

  it("reports when there is no code at all", async () => {
    const result = await verifyOtp(PHONE, "123456", "LOGIN");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("NO_ACTIVE_CODE");
  });

  it("does not accept a code issued for a different purpose", async () => {
    await issue();
    const result = await verifyOtp(PHONE, lastCode, "APPLICATION");
    expect(result.ok).toBe(false);
  });

  it("does not accept a code issued for a different phone", async () => {
    await issue();
    const result = await verifyOtp("+963940000000", lastCode, "LOGIN");
    expect(result.ok).toBe(false);
  });

  it("rate limits verification attempts", async () => {
    await issue();

    // Ten attempts allowed per quarter hour.
    for (let i = 0; i < 10; i++) {
      await verifyOtp(PHONE, "000000", "LOGIN");
    }

    const blocked = await verifyOtp(PHONE, lastCode, "LOGIN");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toBe("RATE_LIMITED");
  });
});
