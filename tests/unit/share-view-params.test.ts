import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHARE_VIEW,
  parseShareView,
  serializeShareView,
} from "@/lib/share-view-params";

describe("share view in the link", () => {
  it("reads every field, switches by presence alone", () => {
    expect(
      parseShareView({
        theme: "dark",
        layout: "grid",
        size: "300x250, 300x600",
        q: "mc:141c hitel",
        commented: "",
        image: "",
      }),
    ).toEqual({
      theme: "dark",
      layout: "grid",
      sizes: ["300x250", "300x600"],
      q: "mc:141c hitel",
      commented: true,
      image: true,
    });
  });

  it("falls back to the default for anything it does not know", () => {
    expect(parseShareView({ theme: "blue", layout: "carousel", size: "" })).toEqual(
      DEFAULT_SHARE_VIEW,
    );
  });

  it("writes nothing for the default view", () => {
    expect(serializeShareView(DEFAULT_SHARE_VIEW)).toBe("");
  });

  it("writes a readable query that reads back the same", () => {
    const view = {
      theme: "light" as const,
      layout: "list" as const,
      sizes: ["300x250", "300x600"],
      q: "mc:141c hitelkártya & co",
      commented: true,
      image: false,
    };
    const query = serializeShareView(view);
    expect(query).toBe(
      "?theme=light&layout=list&size=300x250,300x600&q=mc:141c+hitelk%C3%A1rtya+%26+co&commented",
    );
    expect(parseShareView(Object.fromEntries(new URLSearchParams(query)))).toEqual(view);
  });
});
