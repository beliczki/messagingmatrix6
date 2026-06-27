import { makeCollectionRoute } from "@/lib/entity-route";
import {
  createCreative,
  listCreatives,
  pickWritable,
} from "@/lib/entities/creatives";

export const { GET, POST } = makeCollectionRoute({
  listKey: "creatives",
  itemKey: "creative",
  entityType: "creatives",
  list: listCreatives,
  create: createCreative,
  pickWritable,
});
