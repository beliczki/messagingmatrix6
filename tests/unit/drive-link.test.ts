import { describe, it, expect } from "vitest";
import {
  parseDriveFolderId,
  parseDriveFileId,
  driveFolderUrl,
  driveFileUrl,
} from "@/lib/drive-link";

// Real ids from the live measurement against the ERSTE delivery folders.
const FOLDER = "1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe";
const FILE = "1CqV_cyzunx016Bt4i1n-NuwH6JyS2cug";

describe("parseDriveFolderId", () => {
  it("accepts the shapes Drive hands out for a folder", () => {
    for (const input of [
      `https://drive.google.com/drive/folders/${FOLDER}`,
      `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`,
      `https://drive.google.com/drive/folders/${FOLDER}?usp=drive_link`,
      `https://drive.google.com/drive/u/0/folders/${FOLDER}`,
      `https://drive.google.com/drive/u/0/mobile/folders/${FOLDER}`,
      `https://drive.google.com/open?id=${FOLDER}`,
      `  https://drive.google.com/drive/folders/${FOLDER}  `,
      FOLDER,
    ]) {
      expect(parseDriveFolderId(input)).toBe(FOLDER);
    }
  });

  it("rejects a file link, so it never lands in the folder column", () => {
    expect(parseDriveFolderId(`https://drive.google.com/file/d/${FILE}/view`)).toBeNull();
  });

  it("rejects empty and non-Drive input", () => {
    expect(parseDriveFolderId("")).toBeNull();
    expect(parseDriveFolderId("   ")).toBeNull();
    expect(parseDriveFolderId(null)).toBeNull();
    expect(parseDriveFolderId(undefined)).toBeNull();
    expect(parseDriveFolderId("https://example.com/drive/x")).toBeNull();
    expect(parseDriveFolderId("Leadas 04 13")).toBeNull();
  });
});

describe("parseDriveFileId", () => {
  it("accepts the shapes Drive hands out for a file", () => {
    for (const input of [
      `https://drive.google.com/file/d/${FILE}/view`,
      `https://drive.google.com/file/d/${FILE}/view?usp=drive_link`,
      `https://drive.google.com/file/d/${FILE}`,
      `https://drive.google.com/uc?export=download&id=${FILE}`,
      `https://drive.google.com/open?id=${FILE}`,
      FILE,
    ]) {
      expect(parseDriveFileId(input)).toBe(FILE);
    }
  });

  it("rejects a folder link", () => {
    expect(
      parseDriveFileId(`https://drive.google.com/drive/folders/${FOLDER}`),
    ).toBeNull();
  });
});

describe("url builders", () => {
  it("round-trips an id through its url", () => {
    expect(parseDriveFolderId(driveFolderUrl(FOLDER)!)).toBe(FOLDER);
    expect(parseDriveFileId(driveFileUrl(FILE)!)).toBe(FILE);
  });

  it("passes null through for an unresolved link", () => {
    expect(driveFolderUrl(null)).toBeNull();
    expect(driveFileUrl(undefined)).toBeNull();
  });
});
