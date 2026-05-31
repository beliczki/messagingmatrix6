"use client";

import { useState } from "react";
import RightToolbar from "../../_components/RightToolbar";
import MonitoringUpload from "./MonitoringUpload";
import MonitoringTable from "./MonitoringTable";

export default function MonitoringView() {
  const [reloadToken, setReloadToken] = useState(0);
  return (
    <div className="monitoring flex h-full">
      <div className="monitoring__content flex flex-1 flex-col overflow-hidden">
        <MonitoringTable reloadToken={reloadToken} />
      </div>
      <RightToolbar storageKey="mm6_monitoring_right_toolbar_open">
        {(collapsed) => (
          <MonitoringUpload
            collapsed={collapsed}
            onImported={() => setReloadToken((t) => t + 1)}
          />
        )}
      </RightToolbar>
    </div>
  );
}
