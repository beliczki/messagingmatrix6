import { makeCollectionRoute } from "@/lib/entity-route";
import {
  createTextFormatting,
  listTextFormatting,
  pickWritable,
  TextFormattingError,
} from "@/lib/entities/text-formatting";

export const { GET, POST } = makeCollectionRoute({
  listKey: "text_formatting",
  itemKey: "rule",
  entityType: "text_formatting",
  list: listTextFormatting,
  create: createTextFormatting,
  pickWritable,
  validationError: (e) => (e instanceof TextFormattingError ? e.message : null),
});
