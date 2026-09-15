/**
 * FACE-OFF Game Contract
 * ----------------------
 * Every game on the platform is a module implementing `GameEngine`.
 * The engine is PURE: no I/O, no database, no randomness unless injected.
 * The match server (src/lib/faceoff/engine.server.ts) owns persistence,
 * authorization and broadcasting; the engine only owns rules.
 */

export const CAPABILITIES = [
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
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ROOM_STATUSES = [
  "WAITING",
  "READY",
  "ROUND_STARTED",
  "PLAYER_ACTIONS",
  "RESOLVE",
  "SCORE_UPDATE",
  "NEXT_ROUND",
  "MATCH_COMPLETE",
  "PAUSED",
  "DISCONNECTED",
  "RECONNECTING",
  "CANCELLED",
  "ABORTED",
  "ERROR",
] as const;

export type RoomStatus = (typeof ROOM_STATUSES)[number];

/** Statuses in which a match is actively being played. */
export const ACTIVE_STATUSES: readonly RoomStatus[] = [
  "ROUND_STARTED",
  "PLAYER_ACTIONS",
  "RESOLVE",
  "SCORE_UPDATE",
  "NEXT_ROUND",
];

/** Statuses from which nothing further can happen. */
export const TERMINAL_STATUSES: readonly RoomStatus[] = [
  "MATCH_COMPLETE",
  "CANCELLED",
  "ABORTED",
];

export interface GameManifest {
  slug: string;
  name: string;
  version: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  supportsSpectators: boolean;
  /** True when player intent must stay hidden until the server reveals it. */
  hiddenActions: boolean;
  capabilities: readonly Capability[];
  defaultConfig: Record<string, number | string | boolean>;
}

export interface SubmittedAction<A> {
  seat: number;
  userId: string;
  action: A;
}

export interface ScoreDelta {
  seat: number;
  delta: number;
}

export interface RoundResolution {
  draw: boolean;
  winnerSeat: number | null;
  scoreDelta: ScoreDelta[];
  /** Revealed, spectator-safe detail. Only produced at resolve time. */
  reveal: Record<string, string>;
  summary: string;
  /** True when the same round number must be replayed (e.g. an RPS draw). */
  repeatRound: boolean;
}

export interface SeatScore {
  seat: number;
  userId: string;
  score: number;
  eliminated: boolean;
}

export interface MatchOutcome {
  complete: boolean;
  winnerSeat: number | null;
  reason: "TARGET_SCORE" | "LAST_PLAYER_STANDING" | "NONE";
}

export interface ActionOption {
  value: string;
  label: string;
  /** Short symbol drawn by the UI. Never an emoji. */
  glyph: string;
  beats?: string;
}

export class GameRuleError extends Error {
  public readonly code: string;
  constructor(message: string, code = "GAME_RULE_VIOLATION") {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
  }
}

export interface GameEngine<A = unknown> {
  manifest: GameManifest;
  /** Validate raw client intent. Throws GameRuleError when invalid. */
  parseAction(raw: unknown): A;
  actionOptions(): ActionOption[];
  /** Resolve a complete set of actions for one round. */
  resolveRound(actions: SubmittedAction<A>[]): RoundResolution;
  /** Operator/master override: impose a result without player actions. */
  forceResolve(seats: number[], winnerSeat: number | null): RoundResolution;
  evaluateMatch(scores: SeatScore[], config: Record<string, unknown>): MatchOutcome;
}
