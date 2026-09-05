import { describe, it, expect } from "vitest";
import { parseSlidesFileId, slidesUrl } from "@/lib/slides-link";

const DECK = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const FOLDER = "1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe";

describe("parseSlidesFileId", () => {
  it("accepts every spelling one deck arrives in", () => {
    for (const input of [
      `https://docs.google.com/presentation/d/${DECK}/edit`,
      `https://docs.google.com/presentation/d/${DECK}/edit?usp=sharing`,
      `https://docs.google.com/presentation/d/${DECK}/edit#slide=id.g35f391192_00`,
      `https://docs.google.com/presentation/d/${DECK}/edit?usp=sharing#slide=id.p1`,
      `https://docs.google.com/presentation/u/0/d/${DECK}/edit`,
      `https://docs.google.com/presentation/d/${DECK}/preview`,
      // The same deck shared through Drive rather than the editor — one id,
      // which is the whole reason the id is what gets stored.
      `https://drive.google.com/file/d/${DECK}/view?usp=sharing`,
      `https://drive.google.com/open?id=${DECK}`,
      `  https://docs.google.com/presentation/d/${DECK}/edit  `,
      DECK,
    ]) {
      expect(parseSlidesFileId(input)).toBe(DECK);
    }
  });

  it("groups the editor link and the Drive link as ONE brief", () => {
    expect(parseSlidesFileId(`https://docs.google.com/presentation/d/${DECK}/edit`)).toBe(
      parseSlidesFileId(`https://drive.google.com/file/d/${DECK}/view`),
    );
  });

  it("takes a Doc or a Sheet too — a brief is not always a deck", () => {
    expect(parseSlidesFileId(`https://docs.google.com/document/d/${DECK}/edit`)).toBe(DECK);
    expect(parseSlidesFileId(`https://docs.google.com/spreadsheets/d/${DECK}/edit`)).toBe(DECK);
  });

  it("rejects a folder link so a folder id never lands in the file column", () => {
    expect(
      parseSlidesFileId(`https://drive.google.com/drive/folders/${FOLDER}`),
    ).toBeNull();
    expect(
      parseSlidesFileId(`https://drive.google.com/drive/u/0/folders/${FOLDER}?usp=sharing`),
    ).toBeNull();
  });

  it("returns null for empty and unparseable input", () => {
    expect(parseSlidesFileId("")).toBeNull();
    expect(parseSlidesFileId("   ")).toBeNull();
    expect(parseSlidesFileId(null)).toBeNull();
    expect(parseSlidesFileId(undefined)).toBeNull();
    expect(parseSlidesFileId("not a link")).toBeNull();
    expect(parseSlidesFileId("https://example.com/")).toBeNull();
  });
});

describe("slidesUrl", () => {
  it("round-trips an id back to an editor link", () => {
    expect(parseSlidesFileId(slidesUrl(DECK))).toBe(DECK);
  });

  it("is null for a missing id", () => {
    expect(slidesUrl(null)).toBeNull();
    expect(slidesUrl(undefined)).toBeNull();
  });
});
