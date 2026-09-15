import type {
  ActionOption,
  Capability,
  GameManifest,
  RoomStatus,
} from "@/lib/games/contract";
import type { ViewerRole } from "./permissions";

export interface ParticipantView {
  userId: string;
  displayName: string;
  role: "player" | "spectator";
  seat: number | null;
  score: number;
  eliminated: boolean;
  connected: boolean;
  /** Public-safe: whether a hidden action exists, never what it is. */
  hasSubmitted: boolean;
}

export interface RoundView {
  number: number;
  status: "PENDING" | "OPEN" | "RESOLVED" | "VOIDED";
  forced: boolean;
  result: RoundResultView | null;
}

export interface RoundResultView {
  draw: boolean;
  winnerSeat: number | null;
  summary: string;
  /** Seat -> revealed action. Only present once the server resolved the round. */
  reveal: Record<string, string>;
}

export interface MatchEventView {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEntryView {
  id: number;
  action: string;
  actorName: string;
  actorRole: string | null;
  targetName: string | null;
  payload: Record<string, unknown>;
  result: string;
  createdAt: string;
}

export interface ViewerView {
  userId: string;
  role: ViewerRole;
  seat: number | null;
  isPlayer: boolean;
  isSpectator: boolean;
  capabilities: Capability[];
  /** Only the viewer's own hidden action is ever returned. */
  myAction: string | null;
  hasSubmitted: boolean;
}

export interface RoomView {
  id: string;
  code: string;
  status: RoomStatus;
  previousStatus: RoomStatus | null;
  currentRound: number;
  targetScore: number;
  winnerUserId: string | null;
  errorMessage: string | null;
  createdBy: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface RoomStateView {
  room: RoomView;
  game: GameManifest;
  actionOptions: ActionOption[];
  viewer: ViewerView;
  participants: ParticipantView[];
  round: RoundView | null;
  events: MatchEventView[];
  audit: AuditEntryView[] | null;
  serverTime: string;
}
