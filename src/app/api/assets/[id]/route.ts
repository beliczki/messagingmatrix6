import { makeItemRoute } from "@/lib/entity-route";
import {
  archiveAsset,
  getAsset,
  pickWritable,
  updateAsset,
} from "@/lib/entities/assets";

export const { GET, PATCH, DELETE } = makeItemRoute({
  itemKey: "asset",
  entityType: "assets",
  get: getAsset,
  update: updateAsset,
  archive: archiveAsset,
  pickWritable,
});
