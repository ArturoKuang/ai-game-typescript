import type { NpcAutonomyDebugState, PublicPlayer } from "./types.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatTick(tick?: number | null): string {
  return typeof tick === "number" ? `T${tick}` : "\u2014";
}

export function formatAge(ageTicks: number): string {
  return pluralize(ageTicks, "tick");
}

export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return "\u2014";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s ago`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ago`;
}

export function formatIsoTimestamp(value?: string): string {
  if (!value) return "\u2014";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export function formatClientRole(role: string): string {
  return role.replaceAll("_", " ");
}

export function formatPoint(player: PublicPlayer | undefined): string {
  if (!player) return "unknown";
  return `${Math.round(player.x)}, ${Math.round(player.y)}`;
}

export function formatNpcPoint(
  npcState: NpcAutonomyDebugState,
  player: PublicPlayer | undefined,
): string {
  if (player) {
    return formatPoint(player);
  }
  if (npcState.lastPosition) {
    return `${Math.round(npcState.lastPosition.x)}, ${Math.round(
      npcState.lastPosition.y,
    )}`;
  }
  return "unknown";
}

export function getNpcDeathSummary(npcState: NpcAutonomyDebugState): string {
  if (!npcState.death) {
    return "Cause unknown.";
  }
  if (npcState.death.cause === "survival" && npcState.death.depletedNeed) {
    return `${npcState.death.depletedNeed} reached 0.`;
  }
  if (npcState.death.message) {
    return npcState.death.message;
  }
  if (npcState.death.cause) {
    return npcState.death.cause.replaceAll("_", " ");
  }
  return "Cause unknown.";
}
