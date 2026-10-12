import { describe, expect, it } from "vitest";
import { storedFileHeaders } from "@/lib/stored-file-headers";

describe("storedFileHeaders", () => {
  it("sandboxes active types so an uploaded document never runs on the app origin", () => {
    for (const mime of ["text/html", "image/svg+xml", "application/xhtml+xml"]) {
      expect(storedFileHeaders(mime)).toEqual({
        "Content-Type": mime,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      });
    }
  });

  it("keeps the sandbox on media too — embedding ignores it, a direct open is defused", () => {
    expect(storedFileHeaders("image/png")["Content-Security-Policy"]).toBe("sandbox");
    expect(storedFileHeaders("video/mp4")["Content-Security-Policy"]).toBe("sandbox");
  });

  it("leaves PDF unsandboxed — the browser's viewer will not load in a sandboxed document", () => {
    expect(storedFileHeaders("application/pdf")).toEqual({
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("falls back to octet-stream when no mime was recorded", () => {
    expect(storedFileHeaders(null)["Content-Type"]).toBe("application/octet-stream");
  });
});
