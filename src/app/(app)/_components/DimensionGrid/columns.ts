import { type Audience, type Topic, STATUS_OPTIONS } from "../../matrix/types";

export type CellType =
  | { kind: "text"; readOnly?: boolean }
  | { kind: "number" }
  | { kind: "select"; options: readonly string[] }
  | { kind: "select-dynamic"; source: "product" };

export type Column<T> = {
  key: keyof T & string;
  label: string;
  width: number;
  type: CellType;
  defaultVisible?: boolean;
};

export const AUDIENCE_COLUMNS: Column<Audience>[] = [
  { key: "key", label: "Key", width: 220, type: { kind: "text", readOnly: true }, defaultVisible: true },
  { key: "name", label: "Name", width: 240, type: { kind: "text" }, defaultVisible: true },
  { key: "status", label: "Status", width: 120, type: { kind: "select", options: ["", ...STATUS_OPTIONS] }, defaultVisible: true },
  { key: "product", label: "Product", width: 140, type: { kind: "select-dynamic", source: "product" }, defaultVisible: true },
  { key: "orderIndex", label: "Order", width: 80, type: { kind: "number" }, defaultVisible: true },
  { key: "strategy", label: "Strategy", width: 160, type: { kind: "text" }, defaultVisible: true },
  { key: "device", label: "Device", width: 120, type: { kind: "text" }, defaultVisible: true },
  { key: "buyingPlatform", label: "Buying platform", width: 140, type: { kind: "text" }, defaultVisible: true },
  { key: "dataSource", label: "Data source", width: 140, type: { kind: "text" } },
  { key: "targetingType", label: "Targeting type", width: 140, type: { kind: "text" } },
  { key: "tag", label: "Tag", width: 120, type: { kind: "text" }, defaultVisible: true },
  { key: "campaignName", label: "Campaign name", width: 180, type: { kind: "text" } },
  { key: "campaignId", label: "Campaign ID", width: 140, type: { kind: "text" } },
  { key: "lineitemName", label: "Lineitem name", width: 180, type: { kind: "text" } },
  { key: "lineitemId", label: "Lineitem ID", width: 140, type: { kind: "text" } },
  { key: "comment", label: "Comment", width: 240, type: { kind: "text" } },
];

export const TOPIC_COLUMNS: Column<Topic>[] = [
  { key: "key", label: "Key", width: 220, type: { kind: "text", readOnly: true }, defaultVisible: true },
  { key: "name", label: "Name", width: 240, type: { kind: "text" }, defaultVisible: true },
  { key: "status", label: "Status", width: 120, type: { kind: "select", options: ["", ...STATUS_OPTIONS] }, defaultVisible: true },
  { key: "product", label: "Product", width: 140, type: { kind: "select-dynamic", source: "product" }, defaultVisible: true },
  { key: "orderIndex", label: "Order", width: 80, type: { kind: "number" }, defaultVisible: true },
  { key: "tag", label: "Tag", width: 120, type: { kind: "text" }, defaultVisible: true },
  { key: "tag1", label: "Tag 1", width: 120, type: { kind: "text" }, defaultVisible: true },
  { key: "tag2", label: "Tag 2", width: 120, type: { kind: "text" }, defaultVisible: true },
  { key: "tag3", label: "Tag 3", width: 120, type: { kind: "text" }, defaultVisible: true },
  { key: "tag4", label: "Tag 4", width: 120, type: { kind: "text" }, defaultVisible: true },
  { key: "created", label: "Created", width: 120, type: { kind: "text" } },
  { key: "comment", label: "Comment", width: 240, type: { kind: "text" } },
];
