import { describe, expect, it } from "vitest";
import { ApiError, sanitizeServerText } from "../src/api.js";

describe("ApiError retry semantics", () => {
  it("treats permission and scope failures as non-retryable", () => {
    expect(new ApiError("forbidden", 401).retryable).toBe(false);
    expect(new ApiError("forbidden", 403).retryable).toBe(false);
    expect(new ApiError("not found", 404).retryable).toBe(false);
    expect(new ApiError("conflict", 412).retryable).toBe(false);
  });

  it("treats transient responses as retryable", () => {
    expect(new ApiError("timeout", 408).retryable).toBe(true);
    expect(new ApiError("throttled", 429).retryable).toBe(true);
    expect(new ApiError("boom", 500).retryable).toBe(true);
    expect(new ApiError("gateway", 502).retryable).toBe(true);
  });
});

describe("sanitizeServerText", () => {
  it("masks trust credentials embedded in server error text", () => {
    const leaked =
      "tag mismatch: tskey-client-k522tBdJ5D21CNTRL-abcdefghijklmnopqrstuvwxyz123456 invalid";
    const sanitized = sanitizeServerText(leaked);
    expect(sanitized).not.toContain("k522tBdJ5D21CNTRL");
    expect(sanitized).toContain("tskey-***");
  });

  it("masks bearer/basic authorization material", () => {
    expect(
      sanitizeServerText("used Authorization: Bearer xoPd9s.-Secret8Token"),
    ).toContain("Bearer ***");
    expect(sanitizeServerText("basic c2VjcmV0aW5mbyE=")).toContain("basic ***");
  });

  it("leaves ordinary text untouched", () => {
    const normal = "policy has invalid tagOwners entry";
    expect(sanitizeServerText(normal)).toBe(normal);
  });
});
