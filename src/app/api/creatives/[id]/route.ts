import { makeItemRoute } from "@/lib/entity-route";
import {
  archiveCreative,
  getCreative,
  pickWritable,
  updateCreative,
} from "@/lib/entities/creatives";

export const { GET, PATCH, DELETE } = makeItemRoute({
  itemKey: "creative",
  entityType: "creatives",
  get: getCreative,
  update: updateCreative,
  archive: archiveCreative,
  pickWritable,
});
