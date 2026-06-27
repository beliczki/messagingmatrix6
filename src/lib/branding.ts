import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { config } from "@/db/schema";
import { activeClientId } from "@/lib/active-client";
import { DEFAULT_LOOK_AND_FEEL } from "@/db/defaults";

export type LookAndFeel = typeof DEFAULT_LOOK_AND_FEEL;

export async function getActiveLookAndFeel(): Promise<LookAndFeel> {
  return getLookAndFeelByClientId(await activeClientId());
}

export async function getLookAndFeelByClientId(
  clientId: number,
): Promise<LookAndFeel> {
  const [row] = await db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "lookAndFeel")))
    .limit(1);
  if (!row) return DEFAULT_LOOK_AND_FEEL;

  let parsed: Partial<LookAndFeel>;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return DEFAULT_LOOK_AND_FEEL;
  }

  return {
    ...DEFAULT_LOOK_AND_FEEL,
    ...parsed,
    statusColors: {
      ...DEFAULT_LOOK_AND_FEEL.statusColors,
      ...(parsed.statusColors ?? {}),
    },
    cobranding: {
      ...DEFAULT_LOOK_AND_FEEL.cobranding,
      ...(parsed.cobranding ?? {}),
    },
  };
}

export function lookAndFeelToCssVars(laf: LookAndFeel): Record<string, string> {
  const sc = laf.statusColors;
  return {
    "--brand-primary": laf.headerColor,
    "--brand-button": laf.buttonColor,
    "--brand-secondary-1": laf.secondaryColor1,
    "--brand-secondary-2": laf.secondaryColor2,
    "--brand-secondary-3": laf.secondaryColor3,
    "--brand-secondary-4": laf.secondaryColor4,
    "--font-base": `"${laf.fontFamily}", system-ui, sans-serif`,
    "--status-incoming": sc.INCOMING,
    "--status-naming": sc.NAMING,
    "--status-content": sc.CONTENT,
    "--status-preview": sc.PREVIEW,
    "--status-approved": sc.APPROVED,
    "--status-active": sc.ACTIVE,
    "--status-inactive": sc.INACTIVE,
    "--status-error": sc.ERROR,
    "--status-dead": sc.DEAD,
    "--status-memory": sc.MEMORY,
  };
}
