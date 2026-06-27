import { makeRestoreRoute } from "@/lib/entity-route";
import { getAsset, restoreAsset } from "@/lib/entities/assets";

export const { POST } = makeRestoreRoute({
  itemKey: "asset",
  entityType: "assets",
  get: getAsset,
  restore: restoreAsset,
});
