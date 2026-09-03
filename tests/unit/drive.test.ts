import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getDriveFolder, listDriveFolder, DriveError } from "@/lib/drive";

const FOLDER = "1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe";

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  process.env.GOOGLE_DRIVE_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_DRIVE_API_KEY;
});

describe("getDriveFolder", () => {
  it("returns the folder name when the key can reach it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { id: FOLDER, name: "Leadas 04 13" })),
    );
    expect(await getDriveFolder(FOLDER)).toEqual({
      id: FOLDER,
      name: "Leadas 04 13",
    });
  });

  it("returns null on 404 — the not-shared case, not an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(404, { error: { message: "File not found: x." } }),
      ),
    );
    expect(await getDriveFolder("nope-nope-nope")).toBeNull();
  });

  it("throws on any other HTTP failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, { error: { message: "API key not valid" } }),
      ),
    );
    await expect(getDriveFolder(FOLDER)).rejects.toBeInstanceOf(DriveError);
  });

  it("throws when the key is not configured at all", async () => {
    delete process.env.GOOGLE_DRIVE_API_KEY;
    await expect(getDriveFolder(FOLDER)).rejects.toThrow(
      /GOOGLE_DRIVE_API_KEY/,
    );
  });
});

describe("listDriveFolder", () => {
  it("follows nextPageToken to the end", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          files: [{ id: "a", name: "one.jpg", mimeType: "image/jpeg" }],
          nextPageToken: "PAGE2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          files: [{ id: "b", name: "two.jpg", mimeType: "image/jpeg" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const files = await listDriveFolder(FOLDER);
    expect(files.map((f) => f.name)).toEqual(["one.jpg", "two.jpg"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("pageToken=PAGE2");
  });

  it("returns an empty list for a folder the key cannot see", async () => {
    // Drive answers an unshared parent with 200 + zero files, never an error.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { files: [] })));
    expect(await listDriveFolder("1tuQ6YMD1CzydhUPDVYylReNXwYuO7QgH")).toEqual(
      [],
    );
  });

  it("throws on an HTTP failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(500, { error: { message: "boom" } })),
    );
    await expect(listDriveFolder(FOLDER)).rejects.toBeInstanceOf(DriveError);
  });
});
