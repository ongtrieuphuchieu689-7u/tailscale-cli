import { describe, expect, it } from "vitest";
import { isOffline, matchReason } from "../src/cleanup.js";
import type { Device, ResolvedConfig } from "../src/types.js";

const configBase: ResolvedConfig = {
  profile: "ci",
  tailnet: "-",
  hostname: "web-01",
  tags: ["tag:web"],
  ssh: true,
  keyExpiry: "max",
  preauthorized: true,
  reusable: false,
  ephemeral: true,
  acceptDns: true,
  acceptRoutes: false,
  cleanupAfter: 60,
  source: {
    profile: "runtime",
    hostname: "TS_HOSTNAME",
    tags: "TS_TAGS",
    keyExpiry: "default",
  },
  warnings: [],
};

function device(partial: Partial<Device>): Device {
  return {
    id: "123",
    name: "web-01",
    lastSeen: new Date(Date.now() - 120_000).toISOString(),
    online: false,
    tags: ["tag:web"],
    ...partial,
  } as Device;
}

describe("isOffline", () => {
  it("never treats a device without lastSeen as offline", () => {
    const noSeen = device({}) as Device & { lastSeen?: string };
    delete noSeen.lastSeen;
    expect(isOffline(noSeen, 60)).toBe(false);
    expect(isOffline(device({ online: false }), 0)).toBe(true);
  });

  it("treats an online device as online", () => {
    expect(
      isOffline(
        device({
          online: true,
          lastSeen: new Date(Date.now() - 3_600_000).toISOString(),
        }),
        60,
      ),
    ).toBe(false);
  });

  it("only flags devices offline past the threshold", () => {
    expect(
      isOffline(
        device({ lastSeen: new Date(Date.now() - 30_000).toISOString() }),
        60,
      ),
    ).toBe(false);
    expect(
      isOffline(
        device({ lastSeen: new Date(Date.now() - 120_000).toISOString() }),
        60,
      ),
    ).toBe(true);
  });
});

describe("matchReason (exact-match cleanup)", () => {
  it("matches the exact hostname and every wanted tag", () => {
    expect(matchReason(device({ name: "web-01" }), configBase)).toContain(
      "web-01",
    );
    expect(
      matchReason(device({ dnsName: "web-01.tailadac87.ts.net." }), configBase),
    ).toContain("web-01");
  });

  it("never matches a substring hostname like web-01-old", () => {
    expect(
      matchReason(
        device({ name: "web-01-old", hostname: "web-01-old" }),
        configBase,
      ),
    ).toBeUndefined();
    expect(
      matchReason(
        device({
          name: "web-01-old",
          hostname: "web-01-old",
          dnsName: "web-01-old.tailadac87.ts.net.",
        }),
        configBase,
      ),
    ).toBeUndefined();
  });

  it("requires the wanted tags to be present", () => {
    expect(
      matchReason(device({ tags: ["tag:other"] }), configBase),
    ).toBeUndefined();
  });

  it("matches on hostname alone when no tags are configured", () => {
    const untagged = { ...configBase, tags: [] };
    expect(matchReason(device({ name: "web-01" }), untagged)).toContain(
      "no tag constraint",
    );
  });
});
