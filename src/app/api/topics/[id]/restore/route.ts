import { makeRestoreRoute } from "@/lib/entity-route";
import { getTopic, restoreTopic } from "@/lib/entities/topics";

export const { POST } = makeRestoreRoute({
  itemKey: "topic",
  entityType: "topics",
  get: getTopic,
  restore: restoreTopic,
});
