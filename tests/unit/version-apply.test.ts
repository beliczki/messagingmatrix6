// The Naming tab's "Version" Apply: when it may fire and what it sends.
// The editor serializes every write on one If-Match (the committed snapshot's
// save counter), so Apply must wait for pending edits and in-flight saves
// instead of racing them.
import { describe, it, expect } from "vitest";
import {
  parseVersionNo,
  versionApplyBlock,
  versionApplyRequest,
} from "@/lib/version-apply";

describe("parseVersionNo", () => {
  it.each([
    ["1", 1],
    ["2", 2],
    [" 12 ", 12],
    // The top of Postgres `integer`, the version_no column's type.
    ["2147483647", 2147483647],
  ])("reads %j as %d", (raw, n) => {
    expect(parseVersionNo(raw)).toBe(n);
  });

  it.each(["", "0", "-1", "1.5", "2e1", "abc", "1a", "2147483648", "99999999999999999999"])(
    "refuses %j",
    (raw) => {
      expect(parseVersionNo(raw)).toBeNull();
    },
  );
});

describe("versionApplyBlock", () => {
  const ready = { raw: "2", current: 1, global: false, isDirty: false, busy: false, conflict: false };

  it("lets a new, valid version through", () => {
    expect(versionApplyBlock(ready)).toBeNull();
  });

  it("waits for unsaved edits, so they are saved first and not lost", () => {
    expect(versionApplyBlock({ ...ready, isDirty: true })).toBe("unsaved");
  });

  it("waits while a save or another Apply is in flight", () => {
    expect(versionApplyBlock({ ...ready, busy: true })).toBe("busy");
  });

  it("is blocked by a conflict until the card is reloaded", () => {
    expect(versionApplyBlock({ ...ready, conflict: true, isDirty: true })).toBe("conflict");
  });

  it("has nothing to do on Local when the value is this copy's released version", () => {
    expect(versionApplyBlock({ ...ready, raw: "1" })).toBe("unchanged");
  });

  it("lets Global through at this copy's value: the other copies may be on another one", () => {
    expect(versionApplyBlock({ ...ready, raw: "1", global: true })).toBeNull();
  });

  it("refuses a value that is not a version", () => {
    expect(versionApplyBlock({ ...ready, raw: "0" })).toBe("invalid");
  });
});

describe("versionApplyRequest", () => {
  it("posts to the card's version endpoint with the save counter as If-Match", () => {
    const { url, init } = versionApplyRequest({
      id: 42,
      expectedVersion: 10,
      versionNo: 2,
      global: false,
    });
    expect(url).toBe("/api/messages/42/version");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe("10");
    expect(JSON.parse(init.body as string)).toEqual({ versionNo: 2, scope: "local" });
  });

  it("sends scope global when the editor's toggle is on Global", () => {
    const { init } = versionApplyRequest({ id: 42, expectedVersion: 10, versionNo: 3, global: true });
    expect(JSON.parse(init.body as string)).toEqual({ versionNo: 3, scope: "global" });
  });
});
