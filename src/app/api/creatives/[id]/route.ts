import { makeItemRoute } from "@/lib/entity-route";
import {
  archiveCreative,
  CreativeError,
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
  validationError: (e) => (e instanceof CreativeError ? e.message : null),
});
