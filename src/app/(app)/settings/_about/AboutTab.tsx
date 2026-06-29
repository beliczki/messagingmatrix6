"use client";

type AboutInfo = {
  activeClient: { key: string; name: string; status: string };
  user: { email: string; role: string };
  env: { activeClientKey: string; nodeEnv: string };
  dbPath: string;
  objectStore: string;
  appVersion: string;
};

export function AboutTab({ info }: { info: AboutInfo }) {
  const rows: Array<[string, string]> = [
    ["App version", info.appVersion],
    ["NODE_ENV", info.env.nodeEnv],
    ["ACTIVE_CLIENT_KEY", info.env.activeClientKey],
    [
      "Active client",
      `${info.activeClient.name} (${info.activeClient.key}) — ${info.activeClient.status}`,
    ],
    ["Database path", info.dbPath],
    ["Object store", info.objectStore],
    ["Logged in as", `${info.user.email} (${info.user.role})`],
  ];

  return (
    <div className="about-tab max-w-2xl">
      <header className="mb-6">
        <p className="text-sm text-slate-500">
          Read-only deploy + runtime information.
        </p>
      </header>

      <dl className="about-tab__grid divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="about-tab__row grid grid-cols-[10rem_1fr] items-baseline gap-4 px-4 py-3"
          >
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              {k}
            </dt>
            <dd className="break-all font-mono text-xs text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
