import { makeCollectionRoute } from "@/lib/entity-route";
import {
  createTopic,
  listTopics,
  pickWritable,
  TopicError,
} from "@/lib/entities/topics";

export const { GET, POST } = makeCollectionRoute({
  listKey: "topics",
  itemKey: "topic",
  entityType: "topics",
  list: listTopics,
  create: createTopic,
  pickWritable,
  validationError: (e) => (e instanceof TopicError ? e.message : null),
});
