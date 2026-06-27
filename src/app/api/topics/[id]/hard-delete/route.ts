import { makeHardDeleteRoute } from "@/lib/entity-route";
import { deleteTopic, getTopic } from "@/lib/entities/topics";

export const { POST } = makeHardDeleteRoute({
  entityType: "topics",
  get: getTopic,
  remove: deleteTopic,
});
