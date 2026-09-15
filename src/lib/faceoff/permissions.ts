import {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  type Capability,
  type RoomStatus,
} from "@/lib/games/contract";

export type PlatformRole = "master" | "operator" | "player";
export type ViewerRole = "master" | "operator" | "host" | "player" | "spectator" | "guest";

/** Granular grants per platform role. Master has the highest authority. */
const ROLE_GRANTS: Record<PlatformRole | "host", readonly Capability[]> = {
  master: [
    "START",
    "PAUSE",
    "RESUME",
    "FORCE_ROUND_RESULT",
    "ADJUST_SCORE",
    "ELIMINATE",
    "RESTORE",
    "END_MATCH",
    "RESTART_MATCH",
    "CANCEL_ROOM",
  ],
  operator: ["START", "PAUSE", "RESUME", "END_MATCH", "RESTART_MATCH", "CANCEL_ROOM"],
  host: ["START", "RESTART_MATCH", "CANCEL_ROOM"],
  player: [],
};

/** Status gating — a capability is only offered when it can legally apply. */
const STATUS_RULES: Record<Capability, (status: RoomStatus) => boolean> = {
  START: (s) => s === "READY" || s === "WAITING",
  PAUSE: (s) => ACTIVE_STATUSES.includes(s),
  RESUME: (s) => s === "PAUSED" || s === "DISCONNECTED" || s === "RECONNECTING",
  FORCE_ROUND_RESULT: (s) => ACTIVE_STATUSES.includes(s) || s === "PAUSED",
  ADJUST_SCORE: (s) => !TERMINAL_STATUSES.includes(s),
  ELIMINATE: (s) => !TERMINAL_STATUSES.includes(s),
  RESTORE: (s) => !TERMINAL_STATUSES.includes(s),
  END_MATCH: (s) => !TERMINAL_STATUSES.includes(s),
  RESTART_MATCH: () => true,
  CANCEL_ROOM: (s) => !TERMINAL_STATUSES.includes(s),
};

export interface CapabilityInput {
  platformRoles: PlatformRole[];
  isRoomCreator: boolean;
  gameCapabilities: readonly Capability[];
  status: RoomStatus;
}

/** Capabilities the actor is *granted*, ignoring room status. */
export function grantedCapabilities(
  platformRoles: PlatformRole[],
  isRoomCreator: boolean,
): Capability[] {
  const granted = new Set<Capability>();
  for (const role of platformRoles) {
    for (const cap of ROLE_GRANTS[role]) granted.add(cap);
  }
  if (isRoomCreator) {
    for (const cap of ROLE_GRANTS.host) granted.add(cap);
  }
  return [...granted];
}

/** Capabilities that are granted AND supported by the game AND currently applicable. */
export function capabilitiesFor(input: CapabilityInput): Capability[] {
  return grantedCapabilities(input.platformRoles, input.isRoomCreator)
    .filter((cap) => input.gameCapabilities.includes(cap))
    .filter((cap) => STATUS_RULES[cap](input.status));
}

export function viewerRoleLabel(
  platformRoles: PlatformRole[],
  isRoomCreator: boolean,
  seatedAsPlayer: boolean,
): ViewerRole {
  if (platformRoles.includes("master")) return "master";
  if (platformRoles.includes("operator")) return "operator";
  if (isRoomCreator) return "host";
  return seatedAsPlayer ? "player" : "spectator";
}

export class PermissionError extends Error {
  public readonly code = "FORBIDDEN";
  constructor(message = "You do not have permission to run this command.") {
    super(message);
    this.name = "PermissionError";
  }
}
