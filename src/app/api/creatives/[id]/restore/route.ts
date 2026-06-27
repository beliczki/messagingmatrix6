import { makeRestoreRoute } from "@/lib/entity-route";
import { getCreative, restoreCreative } from "@/lib/entities/creatives";

export const { POST } = makeRestoreRoute({
  itemKey: "creative",
  entityType: "creatives",
  get: getCreative,
  restore: restoreCreative,
});
