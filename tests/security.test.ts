import { describe, expect, it } from "vitest";
import { findSecrets, TSKEX_PATTERN } from "../scripts/secret-pattern.mjs";

describe("secret detection pattern", () => {
  it("flags a real-format client credential", () => {
    const text =
      "the key was tskey-client-KDklKWWQq9mZ3vNxY8tR7pA4cF6jH2sB5dG-9nQwErTyUiOp4 and more";
    expect(findSecrets(text)).toEqual([
      "tskey-client-KDklKWWQq9mZ3vNxY8tR7pA4cF6jH2sB5dG-9nQwErTyUiOp4",
    ]);
  });

  it("flags auth and static credential forms", () => {
    expect(
      findSecrets(
        "tskey-auth-XnB2wM4qR7tY9uI1oL3pK5sV8cE6hG0jFdSaQmZxNv1aBcDeFgH and tskey-static-DkLm4pQ9xZ8w7Y6uI2oP0aN3bVcE5rT1yUj-1aBcDeFgHiJkLmNoPqRsTuV",
      ),
    ).toHaveLength(2);
  });

  it("ignores the documented placeholder examples", () => {
    const text =
      "tskey-client-k522tBdJ5D21CNTRL-xxxxxxxxxxxxxx and tskey-client-k522tBdJ5D21CNTRL-abcdefghijklmnopqrstuvwxyz123456";
    expect(findSecrets(text)).toEqual([]);
  });

  it("ignores short test fixtures", () => {
    const text =
      "tskey-client-abc123-wxyz9876qwer tskey-client-one tskey-client-two";
    expect(findSecrets(text)).toEqual([]);
  });

  it("ignores masked fragments", () => {
    expect(TSKEX_PATTERN.test("tskey…56n")).toBe(false);
  });
});
