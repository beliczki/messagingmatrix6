import { makeHardDeleteRoute } from "@/lib/entity-route";
import { deleteAudience, getAudience } from "@/lib/entities/audiences";

export const { POST } = makeHardDeleteRoute({
  entityType: "audiences",
  get: getAudience,
  remove: deleteAudience,
});
