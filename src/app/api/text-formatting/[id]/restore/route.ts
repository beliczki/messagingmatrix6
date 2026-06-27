import { makeRestoreRoute } from "@/lib/entity-route";
import {
  getTextFormatting,
  restoreTextFormatting,
} from "@/lib/entities/text-formatting";

export const { POST } = makeRestoreRoute({
  itemKey: "rule",
  entityType: "text_formatting",
  get: getTextFormatting,
  restore: restoreTextFormatting,
});
