import { makeDuplicateRoute } from "@/lib/entity-route";
import { duplicateAudience } from "@/lib/entities/audiences";

export const { POST } = makeDuplicateRoute({
  itemKey: "audience",
  entityType: "audiences",
  duplicate: duplicateAudience,
});
