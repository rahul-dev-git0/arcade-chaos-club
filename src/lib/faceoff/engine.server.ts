/**
 * FACE-OFF authoritative match server.
 * ------------------------------------
 * Clients send INTENT only. Every mutation below runs here, behind an
 * authenticated server function, with the pipeline:
 *   authenticate -> authorize -> validate -> execute -> audit -> broadcast
 * Broadcast = an insert into public.match_events, which is realtime-published
 * and contains only spectator-safe data.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ACTIVE_STATUSES,
  GameRuleError,
  TERMINAL_STATUSES,
  type Capability,
  type RoomStatus,
  type SeatScore,
  type SubmittedAction,
} from "@/lib/games/contract";
import { getEngine } from "@/lib/games/registry";
import { capabilitiesFor, PermissionError, viewerRoleLabel, type PlatformRole } from "./permissions";
import type {
  AuditEntryView,
  MatchEventView,
  ParticipantView,
  RoomStateView,
  RoundResultView,
  RoundView,
} from "./types";

type Json = Record<string, unknown>;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class MatchError extends Error {
  public readonly code: string;
  constructor(message: string, code = "MATCH_ERROR") {
    super(message);
    this.name = "MatchError";
    this.code = code;
  }
}

function newCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length] ?? "X").join("");
}

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

async function emit(roomId: string, type: string, payload: Json, actorId?: string | null) {
  await supabaseAdmin.from("match_events").insert({
    room_id: roomId,
    type,
    payload: payload as never,
    actor_id: actorId ?? null,
  });
}

async function audit(entry: {
  roomId: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetUserId?: string | null;
  payload?: Json;
  result?: string;
}) {
  await supabaseAdmin.from("audit_log").insert({
    room_id: entry.roomId,
    actor_id: entry.actorId,
    actor_role: entry.actorRole,
    action: entry.action,
    target_user_id: entry.targetUserId ?? null,
    payload: (entry.payload ?? {}) as never,
    result: entry.result ?? "OK",
  });
}

async function setStatus(roomId: string, status: RoomStatus, extra: Json = {}) {
  await supabaseAdmin
    .from("rooms")
    .update({ status, ...(extra as object) })
    .eq("id", roomId);
  await emit(roomId, "STATUS_CHANGED", { status });
}

export async function getPlatformRoles(userId: string): Promise<PlatformRole[]> {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as PlatformRole);
}

async function loadRoomByCode(code: string) {
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw new MatchError(error.message, "DB_ERROR");
  if (!data) throw new MatchError("That room code does not exist.", "ROOM_NOT_FOUND");
  return data;
}

async function loadParticipants(roomId: string) {
  const { data } = await supabaseAdmin
    .from("room_participants")
    .select("*")
    .eq("room_id", roomId)
    .order("seat", { ascending: true, nullsFirst: false });
  return data ?? [];
}

async function loadCurrentRound(roomId: string, roundNumber: number) {
  if (roundNumber < 1) return null;
  const { data } = await supabaseAdmin
    .from("rounds")
    .select("*")
    .eq("room_id", roomId)
    .eq("round_number", roundNumber)
    .maybeSingle();
  return data;
}

/* ------------------------------------------------------------------ */
/* profiles / identity                                                 */
/* ------------------------------------------------------------------ */

export async function ensureProfile(userId: string, displayName: string, isGuest: boolean) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (data) return data;
  const { data: created, error } = await supabaseAdmin
    .from("profiles")
    .insert({ id: userId, display_name: displayName.slice(0, 32) || "Player", is_guest: isGuest })
    .select("id, display_name")
    .single();
  if (error) throw new MatchError(error.message, "PROFILE_ERROR");
  return created;
}

async function displayNames(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name")
    .in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.display_name]));
}

/* ------------------------------------------------------------------ */
/* room lifecycle                                                      */
/* ------------------------------------------------------------------ */

export async function createRoom(userId: string, gameSlug: string) {
  const engine = getEngine(gameSlug);
  let attempt = 0;
  // Retry on the (astronomically unlikely) code collision.
  for (;;) {
    const code = newCode();
    const { data, error } = await supabaseAdmin
      .from("rooms")
      .insert({
        code,
        game_slug: engine.manifest.slug,
        game_version: engine.manifest.version,
        config: engine.manifest.defaultConfig as never,
        created_by: userId,
        status: "WAITING",
      })
      .select("*")
      .maybeSingle();
    if (data) {
      await supabaseAdmin.from("room_participants").insert({
        room_id: data.id,
        user_id: userId,
        role: "player",
        seat: 0,
      });
      await emit(data.id, "ROOM_CREATED", { code: data.code, game: engine.manifest.slug }, userId);
      await emit(data.id, "PLAYER_JOINED", { seat: 0 }, userId);
      return data;
    }
    if (++attempt > 4) throw new MatchError(error?.message ?? "Could not create room", "DB_ERROR");
  }
}

export async function joinRoom(userId: string, code: string, wantsSpectate: boolean) {
  const room = await loadRoomByCode(code);
  const engine = getEngine(room.game_slug, room.game_version);
  const participants = await loadParticipants(room.id);

  const existing = participants.find((p) => p.user_id === userId);
  if (existing) {
    await supabaseAdmin
      .from("room_participants")
      .update({ connected: true, last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    await maybeResumeFromDisconnect(room.id);
    return room;
  }

  const seated = participants.filter((p) => p.role === "player");
  const canSeat = !wantsSpectate && seated.length < engine.manifest.maxPlayers;

  if (!canSeat && !engine.manifest.supportsSpectators) {
    throw new MatchError("This room is full.", "ROOM_FULL");
  }

  const usedSeats = new Set(seated.map((p) => p.seat));
  let seat: number | null = null;
  if (canSeat) {
    for (let i = 0; i < engine.manifest.maxPlayers; i++) {
      if (!usedSeats.has(i)) {
        seat = i;
        break;
      }
    }
  }

  await supabaseAdmin.from("room_participants").insert({
    room_id: room.id,
    user_id: userId,
    role: canSeat ? "player" : "spectator",
    seat,
  });

  await emit(
    room.id,
    canSeat ? "PLAYER_JOINED" : "SPECTATOR_JOINED",
    canSeat ? { seat } : {},
    userId,
  );

  if (canSeat) {
    const totalSeated = seated.length + 1;
    if (totalSeated >= engine.manifest.minPlayers && room.status === "WAITING") {
      await setStatus(room.id, "READY");
    }
  }
  return room;
}

export async function heartbeat(userId: string, code: string, connected: boolean) {
  const room = await loadRoomByCode(code);
  const { data: me } = await supabaseAdmin
    .from("room_participants")
    .select("*")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!me) return;

  const wasConnected = me.connected;
  await supabaseAdmin
    .from("room_participants")
    .update({ connected, last_seen_at: new Date().toISOString() })
    .eq("id", me.id);

  if (me.role !== "player") return;

  if (!connected && wasConnected && ACTIVE_STATUSES.includes(room.status as RoomStatus)) {
    await supabaseAdmin
      .from("rooms")
      .update({ previous_status: room.status, status: "DISCONNECTED" })
      .eq("id", room.id);
    await emit(room.id, "PLAYER_DISCONNECTED", { seat: me.seat }, userId);
    await emit(room.id, "STATUS_CHANGED", { status: "DISCONNECTED" });
  }

  if (connected && !wasConnected) {
    await emit(room.id, "PLAYER_RECONNECTED", { seat: me.seat }, userId);
    await maybeResumeFromDisconnect(room.id);
  }
}

/** Restore the pre-disconnect status once every seated player is back. */
async function maybeResumeFromDisconnect(roomId: string) {
  const { data: room } = await supabaseAdmin.from("rooms").select("*").eq("id", roomId).single();
  if (!room || (room.status !== "DISCONNECTED" && room.status !== "RECONNECTING")) return;
  const participants = await loadParticipants(roomId);
  const players = participants.filter((p) => p.role === "player" && !p.eliminated);
  if (players.some((p) => !p.connected)) return;
  const restore = (room.previous_status ?? "PLAYER_ACTIONS") as RoomStatus;
  await supabaseAdmin
    .from("rooms")
    .update({ status: restore, previous_status: null })
    .eq("id", roomId);
  await emit(roomId, "MATCH_RESYNCED", { status: restore });
  await emit(roomId, "STATUS_CHANGED", { status: restore });
}

/* ------------------------------------------------------------------ */
/* round machinery                                                     */
/* ------------------------------------------------------------------ */

async function openRound(roomId: string, roundNumber: number) {
  await supabaseAdmin
    .from("rounds")
    .insert({ room_id: roomId, round_number: roundNumber, status: "OPEN" });
  await supabaseAdmin
    .from("rooms")
    .update({ current_round: roundNumber, status: "ROUND_STARTED" })
    .eq("id", roomId);
  await emit(roomId, "ROUND_STARTED", { round: roundNumber });
  await setStatus(roomId, "PLAYER_ACTIONS");
}

export async function startMatch(roomId: string) {
  const { data: room } = await supabaseAdmin.from("rooms").select("*").eq("id", roomId).single();
  if (!room) throw new MatchError("Room missing", "ROOM_NOT_FOUND");
  const engine = getEngine(room.game_slug, room.game_version);
  const players = (await loadParticipants(roomId)).filter((p) => p.role === "player");
  if (players.length < engine.manifest.minPlayers) {
    throw new MatchError(
      `This game needs ${engine.manifest.minPlayers} players to start.`,
      "NOT_ENOUGH_PLAYERS",
    );
  }
  await supabaseAdmin
    .from("rooms")
    .update({ started_at: new Date().toISOString(), winner_user_id: null, ended_at: null })
    .eq("id", roomId);
  await emit(roomId, "MATCH_STARTED", {});
  await openRound(roomId, 1);
}

export async function submitIntent(userId: string, code: string, rawAction: unknown) {
  const room = await loadRoomByCode(code);
  const engine = getEngine(room.game_slug, room.game_version);

  if (room.status !== "PLAYER_ACTIONS") {
    throw new MatchError("The room is not accepting moves right now.", "NOT_ACCEPTING_ACTIONS");
  }

  const participants = await loadParticipants(room.id);
  const me = participants.find((p) => p.user_id === userId);
  if (!me || me.role !== "player" || me.seat === null) {
    throw new MatchError("Only seated players can submit a move.", "NOT_A_PLAYER");
  }
  if (me.eliminated) throw new MatchError("You have been eliminated.", "ELIMINATED");

  const round = await loadCurrentRound(room.id, room.current_round);
  if (!round || round.status !== "OPEN") {
    throw new MatchError("There is no open round.", "NO_OPEN_ROUND");
  }

  const action = engine.parseAction(rawAction);

  const { error } = await supabaseAdmin.from("round_actions").insert({
    round_id: round.id,
    room_id: room.id,
    user_id: userId,
    action: { value: action } as never,
  });
  if (error) {
    if (error.code === "23505") {
      throw new MatchError("You already locked in this round.", "ALREADY_SUBMITTED");
    }
    throw new MatchError(error.message, "DB_ERROR");
  }

  // Broadcast the FACT of a submission — never the choice.
  await emit(room.id, "ACTION_SUBMITTED", { seat: me.seat, round: round.round_number }, userId);

  const activePlayers = participants.filter((p) => p.role === "player" && !p.eliminated);
  const { data: submitted } = await supabaseAdmin
    .from("round_actions")
    .select("user_id, action")
    .eq("round_id", round.id);

  if ((submitted ?? []).length >= activePlayers.length) {
    await resolveRound(room.id, round.id);
  }
}

async function applyScoreDeltas(roomId: string, deltas: { seat: number; delta: number }[]) {
  for (const d of deltas) {
    const { data: p } = await supabaseAdmin
      .from("room_participants")
      .select("id, score")
      .eq("room_id", roomId)
      .eq("seat", d.seat)
      .maybeSingle();
    if (!p) continue;
    await supabaseAdmin
      .from("room_participants")
      .update({ score: Math.max(0, p.score + d.delta) })
      .eq("id", p.id);
  }
}

async function finishOrContinue(roomId: string, roundNumber: number) {
  const { data: room } = await supabaseAdmin.from("rooms").select("*").eq("id", roomId).single();
  if (!room) return;
  const engine = getEngine(room.game_slug, room.game_version);
  const players = (await loadParticipants(roomId)).filter((p) => p.role === "player");
  const scores: SeatScore[] = players.map((p) => ({
    seat: p.seat ?? 0,
    userId: p.user_id,
    score: p.score,
    eliminated: p.eliminated,
  }));

  const outcome = engine.evaluateMatch(scores, (room.config ?? {}) as Record<string, unknown>);
  if (outcome.complete) {
    const winner = scores.find((s) => s.seat === outcome.winnerSeat);
    await supabaseAdmin
      .from("rooms")
      .update({
        status: "MATCH_COMPLETE",
        winner_user_id: winner?.userId ?? null,
        ended_at: new Date().toISOString(),
      })
      .eq("id", roomId);
    await emit(roomId, "MATCH_COMPLETE", {
      winnerSeat: outcome.winnerSeat,
      reason: outcome.reason,
    });
    await emit(roomId, "STATUS_CHANGED", { status: "MATCH_COMPLETE" });
    return;
  }

  await setStatus(roomId, "NEXT_ROUND");
  await openRound(roomId, roundNumber + 1);
}

export async function resolveRound(roomId: string, roundId: string) {
  const { data: room } = await supabaseAdmin.from("rooms").select("*").eq("id", roomId).single();
  if (!room) return;
  const engine = getEngine(room.game_slug, room.game_version);

  await setStatus(roomId, "RESOLVE");

  const participants = await loadParticipants(roomId);
  const { data: actions } = await supabaseAdmin
    .from("round_actions")
    .select("user_id, action")
    .eq("round_id", roundId);

  const submitted: SubmittedAction<never>[] = (actions ?? []).map((a) => {
    const p = participants.find((x) => x.user_id === a.user_id);
    const payload = a.action as { value?: unknown } | null;
    return {
      seat: p?.seat ?? 0,
      userId: a.user_id,
      action: engine.parseAction(payload?.value ?? payload),
    };
  });

  let resolution;
  try {
    resolution = engine.resolveRound(submitted);
  } catch (err) {
    const message = err instanceof GameRuleError ? err.message : "Round could not be resolved.";
    await supabaseAdmin.from("rooms").update({ status: "ERROR", error_message: message }).eq("id", roomId);
    await emit(roomId, "ERROR", { message });
    return;
  }

  await supabaseAdmin
    .from("rounds")
    .update({
      status: "RESOLVED",
      resolved_at: new Date().toISOString(),
      result: {
        draw: resolution.draw,
        winnerSeat: resolution.winnerSeat,
        summary: resolution.summary,
        reveal: resolution.reveal,
      } as never,
    })
    .eq("id", roundId);

  await emit(roomId, "ROUND_RESOLVED", {
    round: room.current_round,
    draw: resolution.draw,
    winnerSeat: resolution.winnerSeat,
    summary: resolution.summary,
    reveal: resolution.reveal,
  });

  await applyScoreDeltas(roomId, resolution.scoreDelta);
  await setStatus(roomId, "SCORE_UPDATE");
  const updated = (await loadParticipants(roomId))
    .filter((p) => p.role === "player")
    .map((p) => ({ seat: p.seat, score: p.score }));
  await emit(roomId, "SCORE_UPDATED", { scores: updated });

  await finishOrContinue(roomId, room.current_round);
}

/* ------------------------------------------------------------------ */
/* privileged commands                                                 */
/* ------------------------------------------------------------------ */

export type MasterCommand =
  | { type: "START" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "FORCE_ROUND_RESULT"; winnerSeat: number | null }
  | { type: "ADJUST_SCORE"; targetUserId: string; delta: number }
  | { type: "ELIMINATE"; targetUserId: string }
  | { type: "RESTORE"; targetUserId: string }
  | { type: "END_MATCH" }
  | { type: "RESTART_MATCH" }
  | { type: "CANCEL_ROOM" };

export async function runCommand(userId: string, code: string, command: MasterCommand) {
  // 1. authenticate — done by requireSupabaseAuth before we get here.
  const room = await loadRoomByCode(code);
  const engine = getEngine(room.game_slug, room.game_version);
  const roles = await getPlatformRoles(userId);
  const isCreator = room.created_by === userId;
  const actorRole = viewerRoleLabel(roles, isCreator, false);

  // 2. authorize
  const allowed = capabilitiesFor({
    platformRoles: roles,
    isRoomCreator: isCreator,
    gameCapabilities: engine.manifest.capabilities,
    status: room.status as RoomStatus,
  });
  if (!allowed.includes(command.type as Capability)) {
    await audit({
      roomId: room.id,
      actorId: userId,
      actorRole,
      action: command.type,
      payload: command as unknown as Json,
      result: "DENIED",
    });
    throw new PermissionError(`${command.type} is not available to you right now.`);
  }

  // 3. validate + 4. execute
  switch (command.type) {
    case "START":
      await startMatch(room.id);
      break;

    case "PAUSE":
      await supabaseAdmin
        .from("rooms")
        .update({ previous_status: room.status, status: "PAUSED" })
        .eq("id", room.id);
      await emit(room.id, "MATCH_PAUSED", {}, userId);
      await emit(room.id, "STATUS_CHANGED", { status: "PAUSED" });
      break;

    case "RESUME": {
      const restore = (room.previous_status ?? "PLAYER_ACTIONS") as RoomStatus;
      await supabaseAdmin
        .from("rooms")
        .update({ status: restore, previous_status: null })
        .eq("id", room.id);
      await emit(room.id, "MATCH_RESUMED", { status: restore }, userId);
      await emit(room.id, "STATUS_CHANGED", { status: restore });
      break;
    }

    case "FORCE_ROUND_RESULT": {
      const players = (await loadParticipants(room.id)).filter((p) => p.role === "player");
      const seats = players.map((p) => p.seat ?? 0);
      const resolution = engine.forceResolve(seats, command.winnerSeat);
      let round = await loadCurrentRound(room.id, room.current_round);
      if (!round) {
        await openRound(room.id, Math.max(1, room.current_round));
        round = await loadCurrentRound(room.id, Math.max(1, room.current_round));
      }
      if (!round) throw new MatchError("No round to force.", "NO_OPEN_ROUND");
      await supabaseAdmin
        .from("rounds")
        .update({
          status: "RESOLVED",
          forced: true,
          resolved_at: new Date().toISOString(),
          result: {
            draw: resolution.draw,
            winnerSeat: resolution.winnerSeat,
            summary: resolution.summary,
            reveal: resolution.reveal,
          } as never,
        })
        .eq("id", round.id);
      await emit(room.id, "ROUND_FORCED", {
        round: round.round_number,
        winnerSeat: resolution.winnerSeat,
        summary: resolution.summary,
        reveal: resolution.reveal,
      }, userId);
      await applyScoreDeltas(room.id, resolution.scoreDelta);
      await setStatus(room.id, "SCORE_UPDATE");
      await finishOrContinue(room.id, round.round_number);
      break;
    }

    case "ADJUST_SCORE": {
      if (!Number.isInteger(command.delta) || Math.abs(command.delta) > 10) {
        throw new MatchError("Score adjustment must be a whole number up to 10.", "BAD_INPUT");
      }
      const { data: target } = await supabaseAdmin
        .from("room_participants")
        .select("id, score, seat, role")
        .eq("room_id", room.id)
        .eq("user_id", command.targetUserId)
        .maybeSingle();
      if (!target || target.role !== "player") {
        throw new MatchError("That participant is not a player in this room.", "BAD_TARGET");
      }
      const next = Math.max(0, target.score + command.delta);
      await supabaseAdmin.from("room_participants").update({ score: next }).eq("id", target.id);
      await emit(room.id, "SCORE_ADJUSTED", { seat: target.seat, score: next, delta: command.delta }, userId);
      await finishOrContinue(room.id, room.current_round);
      break;
    }

    case "ELIMINATE":
    case "RESTORE": {
      const eliminated = command.type === "ELIMINATE";
      const { data: target } = await supabaseAdmin
        .from("room_participants")
        .select("id, seat, role")
        .eq("room_id", room.id)
        .eq("user_id", command.targetUserId)
        .maybeSingle();
      if (!target || target.role !== "player") {
        throw new MatchError("That participant is not a player in this room.", "BAD_TARGET");
      }
      await supabaseAdmin.from("room_participants").update({ eliminated }).eq("id", target.id);
      await emit(room.id, eliminated ? "PLAYER_ELIMINATED" : "PLAYER_RESTORED", { seat: target.seat }, userId);
      if (eliminated) await finishOrContinue(room.id, room.current_round);
      break;
    }

    case "END_MATCH": {
      await supabaseAdmin
        .from("rooms")
        .update({ status: "ABORTED", ended_at: new Date().toISOString() })
        .eq("id", room.id);
      await emit(room.id, "MATCH_ABORTED", {}, userId);
      await emit(room.id, "STATUS_CHANGED", { status: "ABORTED" });
      break;
    }

    case "RESTART_MATCH": {
      await supabaseAdmin.from("rounds").delete().eq("room_id", room.id);
      await supabaseAdmin
        .from("room_participants")
        .update({ score: 0, eliminated: false })
        .eq("room_id", room.id);
      await supabaseAdmin
        .from("rooms")
        .update({
          status: "READY",
          previous_status: null,
          current_round: 0,
          winner_user_id: null,
          ended_at: null,
          error_message: null,
        })
        .eq("id", room.id);
      await emit(room.id, "MATCH_RESTARTED", {}, userId);
      await emit(room.id, "STATUS_CHANGED", { status: "READY" });
      break;
    }

    case "CANCEL_ROOM": {
      await supabaseAdmin
        .from("rooms")
        .update({ status: "CANCELLED", ended_at: new Date().toISOString() })
        .eq("id", room.id);
      await emit(room.id, "ROOM_CANCELLED", {}, userId);
      await emit(room.id, "STATUS_CHANGED", { status: "CANCELLED" });
      break;
    }

    default:
      throw new MatchError("Unknown command.", "UNKNOWN_COMMAND");
  }

  // 5. audit (6. broadcast already happened per-command)
  await audit({
    roomId: room.id,
    actorId: userId,
    actorRole,
    action: command.type,
    targetUserId: "targetUserId" in command ? command.targetUserId : null,
    payload: command as unknown as Json,
  });
}

/* ------------------------------------------------------------------ */
/* read model (with hidden-information redaction)                      */
/* ------------------------------------------------------------------ */

export async function getRoomState(userId: string, code: string): Promise<RoomStateView> {
  const room = await loadRoomByCode(code);
  const engine = getEngine(room.game_slug, room.game_version);
  const participants = await loadParticipants(room.id);
  const round = await loadCurrentRound(room.id, room.current_round);
  const roles = await getPlatformRoles(userId);
  const isCreator = room.created_by === userId;

  const me = participants.find((p) => p.user_id === userId);
  const seatedAsPlayer = me?.role === "player";

  const submittedUserIds = new Set<string>();
  let myAction: string | null = null;
  if (round) {
    const { data: actions } = await supabaseAdmin
      .from("round_actions")
      .select("user_id, action")
      .eq("round_id", round.id);
    for (const a of actions ?? []) {
      submittedUserIds.add(a.user_id);
      // REDACTION: the viewer only ever receives their own hidden choice.
      if (a.user_id === userId) {
        const payload = a.action as { value?: unknown } | null;
        myAction = typeof payload?.value === "string" ? payload.value : null;
      }
    }
  }

  const names = await displayNames(participants.map((p) => p.user_id));

  const participantViews: ParticipantView[] = participants.map((p) => ({
    userId: p.user_id,
    displayName: names.get(p.user_id) ?? "Player",
    role: p.role as "player" | "spectator",
    seat: p.seat,
    score: p.score,
    eliminated: p.eliminated,
    connected: p.connected,
    hasSubmitted: submittedUserIds.has(p.user_id),
  }));

  const rawResult = (round?.result ?? null) as RoundResultView | null;
  const roundView: RoundView | null = round
    ? {
        number: round.round_number,
        status: round.status as RoundView["status"],
        forced: round.forced,
        // Reveal is only attached once the round is RESOLVED.
        result: round.status === "RESOLVED" ? rawResult : null,
      }
    : null;

  const { data: eventRows } = await supabaseAdmin
    .from("match_events")
    .select("id, type, payload, created_at")
    .eq("room_id", room.id)
    .order("id", { ascending: false })
    .limit(40);

  const events: MatchEventView[] = (eventRows ?? [])
    .map((e) => ({
      id: e.id,
      type: e.type,
      payload: (e.payload ?? {}) as Record<string, unknown>,
      createdAt: e.created_at,
    }))
    .reverse();

  let auditView: AuditEntryView[] | null = null;
  if (roles.includes("master") || roles.includes("operator")) {
    const { data: auditRows } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("room_id", room.id)
      .order("id", { ascending: false })
      .limit(50);
    const auditNames = await displayNames([
      ...(auditRows ?? []).map((a) => a.actor_id ?? ""),
      ...(auditRows ?? []).map((a) => a.target_user_id ?? ""),
    ]);
    auditView = (auditRows ?? []).map((a) => ({
      id: a.id,
      action: a.action,
      actorName: auditNames.get(a.actor_id ?? "") ?? "Unknown",
      actorRole: a.actor_role,
      targetName: a.target_user_id ? (auditNames.get(a.target_user_id) ?? null) : null,
      payload: (a.payload ?? {}) as Record<string, unknown>,
      result: a.result,
      createdAt: a.created_at,
    }));
  }

  const config = (room.config ?? {}) as Record<string, unknown>;
  const targetScore = typeof config["targetScore"] === "number" ? (config["targetScore"] as number) : 3;

  return {
    room: {
      id: room.id,
      code: room.code,
      status: room.status as RoomStatus,
      previousStatus: (room.previous_status ?? null) as RoomStatus | null,
      currentRound: room.current_round,
      targetScore,
      winnerUserId: room.winner_user_id,
      errorMessage: room.error_message,
      createdBy: room.created_by,
      startedAt: room.started_at,
      endedAt: room.ended_at,
    },
    game: engine.manifest,
    actionOptions: engine.actionOptions(),
    viewer: {
      userId,
      role: viewerRoleLabel(roles, isCreator, !!seatedAsPlayer),
      seat: me?.seat ?? null,
      isPlayer: !!seatedAsPlayer,
      isSpectator: !me || me.role === "spectator",
      capabilities: capabilitiesFor({
        platformRoles: roles,
        isRoomCreator: isCreator,
        gameCapabilities: engine.manifest.capabilities,
        status: room.status as RoomStatus,
      }),
      myAction,
      hasSubmitted: submittedUserIds.has(userId),
    },
    participants: participantViews,
    round: roundView,
    events,
    audit: auditView,
    serverTime: new Date().toISOString(),
  };
}

export async function listOpenRooms(): Promise<
  { code: string; game: string; status: RoomStatus; players: number; spectators: number }[]
> {
  const { data: rooms } = await supabaseAdmin
    .from("rooms")
    .select("id, code, game_slug, status")
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(12);
  if (!rooms || rooms.length === 0) return [];
  const { data: parts } = await supabaseAdmin
    .from("room_participants")
    .select("room_id, role")
    .in("room_id", rooms.map((r) => r.id));
  return rooms.map((r) => {
    const mine = (parts ?? []).filter((p) => p.room_id === r.id);
    return {
      code: r.code,
      game: r.game_slug,
      status: r.status as RoomStatus,
      players: mine.filter((p) => p.role === "player").length,
      spectators: mine.filter((p) => p.role === "spectator").length,
    };
  });
}
