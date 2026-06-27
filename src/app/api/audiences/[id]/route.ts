import { makeItemRoute } from "@/lib/entity-route";
import {
  archiveAudience,
  getAudience,
  pickWritable,
  updateAudience,
} from "@/lib/entities/audiences";

export const { GET, PATCH, DELETE } = makeItemRoute({
  itemKey: "audience",
  entityType: "audiences",
  get: getAudience,
  update: updateAudience,
  archive: archiveAudience,
  pickWritable,
  cascade: true,
});
