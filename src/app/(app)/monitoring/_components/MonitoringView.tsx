"use client";

import { useState } from "react";
import RightToolbar from "../../_components/RightToolbar";
import MonitoringMatchFilter from "./MonitoringMatchFilter";
import MonitoringUpload from "./MonitoringUpload";
import MonitoringTable, { type MatchFilter } from "./MonitoringTable";

export default function MonitoringView() {
  const [reloadToken, setReloadToken] = useState(0);
  // Owned here because its control sits in the right toolbar while the rows it
  // filters are rendered by the table.
  const [match, setMatch] = useState<MatchFilter>("matched");
  return (
    <div className="monitoring flex h-full">
      <div className="monitoring__content flex flex-1 flex-col overflow-hidden">
        <MonitoringTable
          reloadToken={reloadToken}
          match={match}
          setMatch={setMatch}
        />
      </div>
      <RightToolbar storageKey="mm6_monitoring_right_toolbar_open">
        {(collapsed) => {
          const content = (
            <>
              <MonitoringMatchFilter
                value={match}
                onChange={setMatch}
                collapsed={collapsed}
              />
              <MonitoringUpload
                collapsed={collapsed}
                onImported={() => setReloadToken((t) => t + 1)}
              />
            </>
          );
          // Expanded, the rail is not a flex column on its own, so the upload
          // block's `mt-auto` would not reach the bottom. Same wrapper the
          // assets and creative-library rails use.
          return collapsed ? (
            content
          ) : (
            <div className="flex h-full flex-col gap-3">{content}</div>
          );
        }}
      </RightToolbar>
    </div>
  );
}
