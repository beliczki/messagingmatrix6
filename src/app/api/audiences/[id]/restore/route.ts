import { makeRestoreRoute } from "@/lib/entity-route";
import { getAudience, restoreAudience } from "@/lib/entities/audiences";

export const { POST } = makeRestoreRoute({
  itemKey: "audience",
  entityType: "audiences",
  get: getAudience,
  restore: restoreAudience,
});
