import { makeRekeyRoute } from "@/lib/entity-route";

export const { GET, POST } = makeRekeyRoute({
  itemKey: "topic",
  dimension: "topic",
});
