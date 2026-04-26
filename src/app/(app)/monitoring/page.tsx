import { Placeholder } from "../_placeholder";
import RightToolbar from "../_components/RightToolbar";

export default function Page() {
  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-auto">
        <Placeholder
          phase="Phase 6"
          title="Monitoring"
          description="AdForm sync results — banner-level performance with CTR. UI lands in Phase 6 (regex extraction is already locked by v5 fixtures)."
        />
      </div>
      <RightToolbar storageKey="mm6_monitoring_right_toolbar_open" />
    </div>
  );
}
