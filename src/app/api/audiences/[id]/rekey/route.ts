import { makeRekeyRoute } from "@/lib/entity-route";

export const { GET, POST } = makeRekeyRoute({
  itemKey: "audience",
  dimension: "audience",
});
