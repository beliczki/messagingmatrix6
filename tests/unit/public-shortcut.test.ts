import { describe, expect, it } from "vitest";
import {
  generateSecret,
  signPackageTokenWith,
  signTokenWith,
  verifyPackageTokenWith,
  verifyTokenWith,
} from "@/lib/public-shortcut";

describe("public shortcut tokens", () => {
  const secret = "Magic123!";

  it("round-trips a message and a creative token", () => {
    expect(verifyTokenWith(secret, signTokenWith(secret, "m", 1877))).toEqual({
      kind: "m",
      id: 1877,
    });
    expect(verifyTokenWith(secret, signTokenWith(secret, "c", 3412))).toEqual({
      kind: "c",
      id: 3412,
    });
  });

  it("is computable from outside — the documented HMAC recipe", () => {
    // What a user or an agent would compute in one line of python/node.
    expect(signTokenWith("Magic123!", "m", 1877)).toBe(
      "m1877.b990c3f692bb257c",
    );
  });

  it("rejects a tampered id, a tampered signature and a foreign secret", () => {
    const token = signTokenWith(secret, "m", 1877);
    expect(verifyTokenWith(secret, token.replace("1877", "1878"))).toBeNull();
    expect(verifyTokenWith(secret, token.replace(/.$/, "0"))).toBeNull();
    expect(verifyTokenWith("other-secret", token)).toBeNull();
    // Same id, other kind — the kind is part of the signed payload.
    expect(verifyTokenWith(secret, `c1877.${token.split(".")[1]}`)).toBeNull();
  });

  it("rejects malformed shapes without throwing", () => {
    for (const bad of [
      "",
      "m1877",
      "m1877.",
      "1877.b990c3f692bb257c",
      "x1877.b990c3f692bb257c",
      "m1877.b990c3f692bb257", // 15 chars
      "m1877.b990c3f692bb257cc", // 17 chars
      "m1877.B990C3F692BB257C", // uppercase hex
      "m1877.zzzzzzzzzzzzzzzz",
      "m0.b990c3f692bb257c",
      "m-1.b990c3f692bb257c",
    ]) {
      expect(verifyTokenWith(secret, bad)).toBeNull();
    }
  });

  it("generates a distinct, url-safe secret", () => {
    const a = generateSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(generateSecret());
  });
});

describe("package tokens", () => {
  const secret = "Magic123!";
  const fileId = "AqtSQ11YWwuAH11H-vuxQ";

  it("round-trips an uploaded file id", () => {
    expect(verifyPackageTokenWith(secret, signPackageTokenWith(secret, fileId))).toBe(fileId);
  });

  it("refuses a tampered id, a foreign secret and a malformed token", () => {
    const token = signPackageTokenWith(secret, fileId);
    const sig = token.split(".")[1];
    expect(verifyPackageTokenWith(secret, `OtherFileId1234567890.${sig}`)).toBeNull();
    expect(verifyPackageTokenWith("other-secret", token)).toBeNull();
    expect(verifyPackageTokenWith(secret, fileId)).toBeNull();
    expect(verifyPackageTokenWith(secret, `../x.${sig}`)).toBeNull();
  });

  it("never verifies as a message or creative token, nor the other way round", () => {
    // Different payload prefix: a package token for file "c12" is not c12.
    const pkg = signPackageTokenWith(secret, "c12");
    expect(verifyTokenWith(secret, pkg)).toBeNull();
    expect(verifyPackageTokenWith(secret, signTokenWith(secret, "c", 12))).toBeNull();
  });
});
