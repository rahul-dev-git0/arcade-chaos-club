import {
  GameRuleError,
  type ActionOption,
  type GameEngine,
  type GameManifest,
  type MatchOutcome,
  type RoundResolution,
  type SeatScore,
  type SubmittedAction,
} from "./contract";

export type RpsMove = "ROCK" | "PAPER" | "SCISSORS";

const MOVES: RpsMove[] = ["ROCK", "PAPER", "SCISSORS"];

const BEATS: Record<RpsMove, RpsMove> = {
  ROCK: "SCISSORS",
  PAPER: "ROCK",
  SCISSORS: "PAPER",
};

const LABEL: Record<RpsMove, string> = {
  ROCK: "Rock",
  PAPER: "Paper",
  SCISSORS: "Scissors",
};

export const rpsManifest: GameManifest = {
  slug: "rps",
  name: "Rock Paper Scissors",
  version: "1.0.0",
  tagline: "Hidden hands. First to three.",
  minPlayers: 2,
  maxPlayers: 2,
  supportsSpectators: true,
  hiddenActions: true,
  capabilities: [
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
  defaultConfig: { targetScore: 3 },
};

function isMove(value: unknown): value is RpsMove {
  return typeof value === "string" && (MOVES as string[]).includes(value);
}

export const rpsEngine: GameEngine<RpsMove> = {
  manifest: rpsManifest,

  parseAction(raw: unknown): RpsMove {
    const value =
      typeof raw === "object" && raw !== null && "move" in raw
        ? (raw as { move: unknown }).move
        : raw;
    if (!isMove(value)) {
      throw new GameRuleError("Invalid move. Expected ROCK, PAPER or SCISSORS.", "INVALID_ACTION");
    }
    return value;
  },

  actionOptions(): ActionOption[] {
    return [
      { value: "ROCK", label: "Rock", glyph: "R", beats: "Scissors" },
      { value: "PAPER", label: "Paper", glyph: "P", beats: "Rock" },
      { value: "SCISSORS", label: "Scissors", glyph: "S", beats: "Paper" },
    ];
  },

  resolveRound(actions: SubmittedAction<RpsMove>[]): RoundResolution {
    if (actions.length !== 2) {
      throw new GameRuleError("Rock Paper Scissors resolves exactly two hands.", "BAD_ACTION_SET");
    }
    const [a, b] = actions as [SubmittedAction<RpsMove>, SubmittedAction<RpsMove>];
    const reveal: Record<string, string> = {
      [String(a.seat)]: a.action,
      [String(b.seat)]: b.action,
    };

    if (a.action === b.action) {
      return {
        draw: true,
        winnerSeat: null,
        scoreDelta: [],
        reveal,
        summary: `Both played ${LABEL[a.action]}. Draw — replay the round.`,
        repeatRound: true,
      };
    }

    const aWins = BEATS[a.action] === b.action;
    const winner = aWins ? a : b;
    const loser = aWins ? b : a;

    return {
      draw: false,
      winnerSeat: winner.seat,
      scoreDelta: [{ seat: winner.seat, delta: 1 }],
      reveal,
      summary: `${LABEL[winner.action]} beats ${LABEL[loser.action]}.`,
      repeatRound: false,
    };
  },

  forceResolve(seats: number[], winnerSeat: number | null): RoundResolution {
    if (winnerSeat !== null && !seats.includes(winnerSeat)) {
      throw new GameRuleError("Forced winner is not seated in this match.", "BAD_FORCE_TARGET");
    }
    if (winnerSeat === null) {
      return {
        draw: true,
        winnerSeat: null,
        scoreDelta: [],
        reveal: {},
        summary: "Round forced to a draw by an operator.",
        repeatRound: true,
      };
    }
    return {
      draw: false,
      winnerSeat,
      scoreDelta: [{ seat: winnerSeat, delta: 1 }],
      reveal: {},
      summary: `Round forced to seat ${winnerSeat + 1} by an operator.`,
      repeatRound: false,
    };
  },

  evaluateMatch(scores: SeatScore[], config: Record<string, unknown>): MatchOutcome {
    const rawTarget = config["targetScore"];
    const target = typeof rawTarget === "number" && rawTarget > 0 ? rawTarget : 3;

    const reached = scores.find((s) => !s.eliminated && s.score >= target);
    if (reached) {
      return { complete: true, winnerSeat: reached.seat, reason: "TARGET_SCORE" };
    }

    const alive = scores.filter((s) => !s.eliminated);
    if (scores.length >= 2 && alive.length === 1 && alive[0]) {
      return { complete: true, winnerSeat: alive[0].seat, reason: "LAST_PLAYER_STANDING" };
    }
    if (scores.length >= 2 && alive.length === 0) {
      return { complete: true, winnerSeat: null, reason: "LAST_PLAYER_STANDING" };
    }

    return { complete: false, winnerSeat: null, reason: "NONE" };
  },
};
