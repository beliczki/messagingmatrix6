import { makeItemRoute } from "@/lib/entity-route";
import {
  archiveTextFormatting,
  getTextFormatting,
  pickWritable,
  updateTextFormatting,
} from "@/lib/entities/text-formatting";

export const { GET, PATCH, DELETE } = makeItemRoute({
  itemKey: "rule",
  entityType: "text_formatting",
  get: getTextFormatting,
  update: updateTextFormatting,
  archive: archiveTextFormatting,
  pickWritable,
});
