import { makeItemRoute } from "@/lib/entity-route";
import {
  archiveTopic,
  getTopic,
  pickWritable,
  updateTopic,
} from "@/lib/entities/topics";

export const { GET, PATCH, DELETE } = makeItemRoute({
  itemKey: "topic",
  entityType: "topics",
  get: getTopic,
  update: updateTopic,
  archive: archiveTopic,
  pickWritable,
  cascade: true,
});
