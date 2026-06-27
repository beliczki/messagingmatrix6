import { makeCollectionRoute } from "@/lib/entity-route";
import {
  BadRequest,
  createAudience,
  listAudiences,
  pickWritable,
} from "@/lib/entities/audiences";

export const { GET, POST } = makeCollectionRoute({
  listKey: "audiences",
  itemKey: "audience",
  entityType: "audiences",
  list: listAudiences,
  create: createAudience,
  pickWritable,
  validationError: (e) => (e instanceof BadRequest ? e.message : null),
});
