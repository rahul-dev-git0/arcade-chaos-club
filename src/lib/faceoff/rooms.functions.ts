import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { RoomStateView } from "./types";

const codeSchema = z
  .string()
  .trim()
  .min(4)
  .max(8)
  .transform((v) => v.toUpperCase());

export const registerSelf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { displayName: string; isGuest: boolean }) =>
    z.object({ displayName: z.string().trim().min(1).max(32), isGuest: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { ensureProfile } = await import("./engine.server");
    await ensureProfile(context.userId, data.displayName, data.isGuest);
    return { ok: true };
  });

export const createRoomFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { gameSlug: string }) =>
    z.object({ gameSlug: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { createRoom } = await import("./engine.server");
    const room = await createRoom(context.userId, data.gameSlug);
    return { code: room.code };
  });

export const joinRoomFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string; spectate: boolean }) =>
    z.object({ code: codeSchema, spectate: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { joinRoom } = await import("./engine.server");
    const room = await joinRoom(context.userId, data.code, data.spectate);
    return { code: room.code };
  });

export const getRoomStateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data, context }): Promise<RoomStateView> => {
    const { getRoomState } = await import("./engine.server");
    return getRoomState(context.userId, data.code);
  });

export const submitActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string; move: string }) =>
    z.object({ code: codeSchema, move: z.string().min(1).max(32) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { submitIntent } = await import("./engine.server");
    await submitIntent(context.userId, data.code, { move: data.move });
    return { ok: true };
  });

export const heartbeatFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string; connected: boolean }) =>
    z.object({ code: codeSchema, connected: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { heartbeat } = await import("./engine.server");
    await heartbeat(context.userId, data.code, data.connected);
    return { ok: true };
  });

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START") }),
  z.object({ type: z.literal("PAUSE") }),
  z.object({ type: z.literal("RESUME") }),
  z.object({ type: z.literal("FORCE_ROUND_RESULT"), winnerSeat: z.number().int().min(0).max(7).nullable() }),
  z.object({ type: z.literal("ADJUST_SCORE"), targetUserId: z.string().uuid(), delta: z.number().int().min(-10).max(10) }),
  z.object({ type: z.literal("ELIMINATE"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("RESTORE"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("END_MATCH") }),
  z.object({ type: z.literal("RESTART_MATCH") }),
  z.object({ type: z.literal("CANCEL_ROOM") }),
]);

export type CommandInput = z.infer<typeof commandSchema>;

export const runCommandFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string; command: CommandInput }) =>
    z.object({ code: codeSchema, command: commandSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { runCommand } = await import("./engine.server");
    await runCommand(context.userId, data.code, data.command);
    return { ok: true };
  });

export const listRoomsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { listOpenRooms } = await import("./engine.server");
    return listOpenRooms();
  });
