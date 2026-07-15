import crypto from "node:crypto";

// Same recipe + mask format the old clients.mcp_token rotate route used.
export function generateToken(): string {
  return "mcp_" + crypto.randomBytes(32).toString("hex");
}

export function maskToken(token: string): string {
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
