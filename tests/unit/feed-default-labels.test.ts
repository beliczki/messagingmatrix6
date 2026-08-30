import { describe, expect, it } from "vitest";

import {
  applyDefaultLabelTransforms,
  applyDefaultUrlTransforms,
} from "@/lib/feed-export";

describe("applyDefaultLabelTransforms", () => {
  it("rewrites the audience segment to DEFAULT", () => {
    expect(
      applyDefaultLabelTransforms(
        "p_adform-s_rem-a_SZA_afrtsegallvisitors-m_315-t_SZA_app-v_a-n_1",
      ),
    ).toBe("p_adform-s_rem-a_DEFAULT-m_315-t_SZA_app-v_a-n_1");
  });

  it("rewrites audience keys that contain hyphens", () => {
    expect(
      applyDefaultLabelTransforms(
        "p_adform-s_rem-a_SZA_rtg-allvisitors_IDF-m_315-t_SZA_app-v_a-n_1",
      ),
    ).toBe("p_adform-s_rem-a_DEFAULT-m_315-t_SZA_app-v_a-n_1");
  });

  it("rewrites the lineitem suffix to ANY", () => {
    expect(
      applyDefaultLabelTransforms(
        "p_adform-s_rem-a_SZA_rtg-allvisitors_IDF-m_315-t_SZA_app-v_a-n_1-l_42",
      ),
    ).toBe("p_adform-s_rem-a_DEFAULT-m_315-t_SZA_app-v_a-n_1-l_ANY");
  });
});

describe("applyDefaultUrlTransforms", () => {
  // Real SZA clickTAG from feed export #35 (audience key contains a hyphen).
  const url =
    "https://www.erstebank.hu/hu/x?utm_campaign=26!1!account!x!hu!ebh!mID26-00018!longterm!...!v11" +
    "&utm_source=adform&utm_medium=display&utm_content=banner" +
    "&utm_term=con!adform!SZA_rtg-allvisitors_IDF!...!hu!315a" +
    "&utm_cd26=p_adform-s_rem-a_SZA_rtg-allvisitors_IDF-m_315-t_SZA_app-v_a-n_1&";

  const out = applyDefaultUrlTransforms(url, "SZA_rtg-allvisitors_IDF");

  it("rewrites the audience key inside utm_cd26's PMMID", () => {
    expect(out).toContain(
      "utm_cd26=p_adform-s_rem-a_DEFAULT-m_315-t_SZA_app-v_a-n_1&",
    );
  });

  it("rewrites the standalone audience token in utm_term", () => {
    expect(out).toContain("utm_term=con!adform!DEFAULT!...!hu!315a");
  });

  it("leaves utm_campaign / utm_source untouched", () => {
    expect(out).toContain("&utm_source=adform&");
    expect(out).toContain(
      "utm_campaign=26!1!account!x!hu!ebh!mID26-00018!longterm!...!v11",
    );
  });

  it("leaves the URL alone when the key does not occur", () => {
    expect(applyDefaultUrlTransforms(url, "SZK_wlhr")).toBe(url);
  });
});
