import { makeCollectionRoute } from "@/lib/entity-route";
import {
  createMessage,
  listMessages,
  MessageError,
  pickWritable,
} from "@/lib/entities/messages";

export const { GET, POST } = makeCollectionRoute({
  listKey: "messages",
  itemKey: "message",
  entityType: "messages",
  list: listMessages,
  create: createMessage,
  pickWritable,
  validationError: (e) => (e instanceof MessageError ? e.message : null),
});
