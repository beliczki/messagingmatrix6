// The PMMID + trafficking columns of a message, in DB-column shape.
//
// Every path that creates or re-places a message has to rebuild these together
// and IN THIS ORDER: the PMMID first, because utm_cd26 = {{PMMID}} and
// final_trafficked_url embeds utm_cd26, so trafficking generated against a
// stale id silently disagrees with the row's own PMMID. That ordering was
// open-coded in createMessage / copyMessages / moveMessages; it lives here now
// so a fourth caller (the topic/audience rekey cascade) cannot get it wrong.
//
// Pure — no db, no entity imports — so `entities/rekey.ts` can use it without
// pulling in `entities/messages.ts` (same no-import-cycle reason as mc-refs.ts).
import { generatePmmid } from "@/lib/pmmid";
import {
  buildTrafficking,
  type AudienceFlat,
  type TopicFlat,
  type TraffickingPatternBag,
} from "@/lib/trafficking";

// Where the message sits. `versionNo` is the v5 message-revision counter the
// PMMID pattern reads as {{Version}} — NOT the optimistic-lock `version`.
export type IdentityPlacement = {
  audience: string;
  topic: string;
  number: number;
  variant: string;
  versionNo: number;
  landingUrl?: string | null;
};

// The resolved rows + client patterns the two generators evaluate against.
// `audienceList` backs the by-key lookups ({{audiences[Audience_Key].Field}}).
export type IdentityContext = {
  audienceRow: AudienceFlat;
  topicRow: TopicFlat;
  patterns: (TraffickingPatternBag & { pmmid?: string }) | null | undefined;
  audienceList: ReadonlyArray<Record<string, unknown>>;
};

export type TraffickingColumns = {
  utmCampaign: string;
  utmSource: string;
  utmMedium: string;
  utmContent: string;
  utmTerm: string;
  utmCd26: string;
  finalTraffickedUrl: string;
};

export type IdentityColumns = TraffickingColumns & { pmmid: string };

/** Trafficking columns for an EXISTING pmmid (edit path — the id is stable). */
export function traffickingColumns(
  placement: IdentityPlacement,
  ctx: IdentityContext,
  pmmid: string | null,
): TraffickingColumns {
  const t = buildTrafficking(
    {
      number: placement.number,
      variant: placement.variant,
      audience: placement.audience,
      topic: placement.topic,
      landingUrl: placement.landingUrl,
    },
    ctx.audienceRow,
    ctx.topicRow,
    ctx.patterns,
    ctx.audienceList,
    pmmid,
  );
  return {
    utmCampaign: t.utm_campaign,
    utmSource: t.utm_source,
    utmMedium: t.utm_medium,
    utmContent: t.utm_content,
    utmTerm: t.utm_term,
    utmCd26: t.utm_cd26,
    finalTraffickedUrl: t.final_trafficked_url,
  };
}

/** A fresh PMMID + the trafficking columns built from it (create/copy/move/rekey). */
export function regeneratedIdentity(
  placement: IdentityPlacement,
  ctx: IdentityContext,
): IdentityColumns {
  const pmmid = generatePmmid(
    {
      audience: placement.audience,
      topic: placement.topic,
      number: placement.number,
      variant: placement.variant,
      versionNo: placement.versionNo,
    },
    ctx.audienceList,
    [],
    ctx.patterns?.pmmid,
  );
  return { pmmid, ...traffickingColumns(placement, ctx, pmmid) };
}
