import { makeCollectionRoute } from "@/lib/entity-route";
import {
  CreativeError,
  listCreatives,
  pickWritable,
} from "@/lib/entities/creatives";
import { createCreativeWithMirror } from "@/lib/entities/promote";

export const { GET, POST } = makeCollectionRoute({
  listKey: "creatives",
  itemKey: "creative",
  entityType: "creatives",
  list: listCreatives,
  create: createCreativeWithMirror,
  pickWritable,
  validationError: (e) => (e instanceof CreativeError ? e.message : null),
});
