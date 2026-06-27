import { makeDuplicateRoute } from "@/lib/entity-route";
import { duplicateTopic } from "@/lib/entities/topics";

export const { POST } = makeDuplicateRoute({
  itemKey: "topic",
  entityType: "topics",
  duplicate: duplicateTopic,
});
