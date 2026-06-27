import { makeCollectionRoute } from "@/lib/entity-route";
import { createAsset, listAssets, pickWritable } from "@/lib/entities/assets";

export const { GET, POST } = makeCollectionRoute({
  listKey: "assets",
  itemKey: "asset",
  entityType: "assets",
  list: listAssets,
  create: createAsset,
  pickWritable,
});
