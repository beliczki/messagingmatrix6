import { makeCollectionRoute } from "@/lib/entity-route";
import {
  createCreative,
  CreativeError,
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
  validationError: (e) => (e instanceof CreativeError ? e.message : null),
});
