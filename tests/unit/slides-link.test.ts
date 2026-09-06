import { describe, it, expect } from "vitest";
import {
  parseSlideAnchor,
  parseSlidesFileId,
  slidesEmbedUrl,
  slidesUrl,
} from "@/lib/slides-link";

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

describe("parseSlideAnchor", () => {
  it("pulls the page object id out of a slide deep link", () => {
    expect(
      parseSlideAnchor(
        `https://docs.google.com/presentation/d/${DECK}/edit#slide=id.g35f391192_00`,
      ),
    ).toBe("g35f391192_00");
    // The first slide of a deck is `p`, later ones `p1`, `p2` — all valid.
    expect(
      parseSlideAnchor(
        `https://docs.google.com/presentation/d/${DECK}/edit#slide=id.p1`,
      ),
    ).toBe("p1");
  });

  it("finds the anchor behind a query string and around whitespace", () => {
    expect(
      parseSlideAnchor(
        `  https://docs.google.com/presentation/d/${DECK}/edit?usp=sharing#slide=id.g12ab_0_1  `,
      ),
    ).toBe("g12ab_0_1");
    // Published/embed links carry it as a query parameter instead.
    expect(
      parseSlideAnchor(
        `https://docs.google.com/presentation/d/${DECK}/embed?start=false&slide=id.g99`,
      ),
    ).toBe("g99");
  });

  it("is null for a plain deck link — that means 'the deck', not an error", () => {
    expect(
      parseSlideAnchor(`https://docs.google.com/presentation/d/${DECK}/edit`),
    ).toBeNull();
    expect(parseSlideAnchor(DECK)).toBeNull();
    expect(parseSlideAnchor("")).toBeNull();
    expect(parseSlideAnchor(null)).toBeNull();
    expect(parseSlideAnchor(undefined)).toBeNull();
  });

  // The two parsers read one link for two different things: the deck is the
  // brief's identity, the slide is the card's. Neither may swallow the other.
  it("leaves the file id untouched — the fragment is not part of the deck", () => {
    const link = `https://docs.google.com/presentation/d/${DECK}/edit#slide=id.g7`;
    expect(parseSlidesFileId(link)).toBe(DECK);
    expect(parseSlideAnchor(link)).toBe("g7");
  });
});

describe("slidesEmbedUrl", () => {
  it("addresses the exact slide, and round-trips through both parsers", () => {
    const url = slidesEmbedUrl(DECK, "g35f391192_00")!;
    expect(parseSlidesFileId(url)).toBe(DECK);
    expect(parseSlideAnchor(url)).toBe("g35f391192_00");
  });

  it("omits the slide parameter when there is no anchor", () => {
    const url = slidesEmbedUrl(DECK)!;
    expect(url).not.toContain("slide=");
    expect(parseSlidesFileId(url)).toBe(DECK);
  });

  it("is null without a deck", () => {
    expect(slidesEmbedUrl(null, "g1")).toBeNull();
    expect(slidesEmbedUrl(undefined)).toBeNull();
  });
});
