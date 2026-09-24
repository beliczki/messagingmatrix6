import { describe, expect, it } from "vitest";
import {
  generateSecret,
  signTokenWith,
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
