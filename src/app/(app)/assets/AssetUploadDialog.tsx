"use client";

import { useEffect, useMemo, useRef } from "react";
import BatchUploadDialog, {
  type BatchColumn,
} from "../_components/BatchUploadDialog";
import { useUploadQueue, type QueueItem } from "../_components/UploadQueue";
import { type ParseRules } from "@/lib/parse-filename";

// The metadata columns an asset row exposes. Order = column order in the table
// and in the batch row above it.
const COLUMNS: BatchColumn[] = [
  { key: "brand", label: "Brand" },
  { key: "product", label: "Product" },
  { key: "type", label: "Type" },
  { key: "visualKeyword", label: "Keywords" },
];

type Props = {
  open: boolean;
  /** Files handed over by the page's drop target; [] when opened by the button. */
  initialFiles: File[];
  parsingRules: ParseRules;
  productOptions: string[];
  typeOptions: string[];
  commitItem: (item: QueueItem) => Promise<void>;
  onAllDone: () => void;
  onClose: () => void;
};

export default function AssetUploadDialog({
  open,
  initialFiles,
  parsingRules,
  productOptions,
  typeOptions,
  commitItem,
  onAllDone,
  onClose,
}: Props) {
  const queue = useUploadQueue({
    category: "asset",
    parsingRules,
    commitItem,
    onAllDone,
  });
  const { addFiles } = queue;

  // The page hands the dropped files over once, on open.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    if (initialFiles.length > 0) addFiles(initialFiles);
  }, [open, initialFiles, addFiles]);

  const optionsFor = useMemo(
    () => ({ product: productOptions, type: typeOptions }),
    [productOptions, typeOptions],
  );

  return (
    <BatchUploadDialog
      open={open}
      queue={queue}
      title="Upload assets"
      block="asset-upload"
      columns={COLUMNS}
      optionsFor={optionsFor}
      onClose={() => {
        queue.reset();
        onClose();
      }}
    />
  );
}
