import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getRoomStateFn, heartbeatFn, registerSelf } from "./rooms.functions";
import type { RoomStateView } from "./types";

export type ConnectionState = "CONNECTED" | "DISCONNECTED" | "RECONNECTING" | "SYNCHRONIZING";

const GUEST_KEY = "faceoff.guest.credentials";

export interface SessionUser {
  id: string;
  displayName: string;
}

export function useSession() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const register = useServerFn(registerSelf);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    void supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signInAsGuest = useCallback(
    async (displayName: string) => {
      let stored: { email: string; password: string } | null = null;
      try {
        stored = JSON.parse(localStorage.getItem(GUEST_KEY) ?? "null");
      } catch {
        stored = null;
      }
      if (stored) {
        const { error } = await supabase.auth.signInWithPassword(stored);
        if (!error) {
          await register({ data: { displayName, isGuest: true } });
          return;
        }
      }
      const suffix = crypto.randomUUID().slice(0, 12);
      const creds = { email: `guest-${suffix}@faceoff.guest`, password: crypto.randomUUID() };
      const { error } = await supabase.auth.signUp(creds);
      if (error) throw error;
      const signIn = await supabase.auth.signInWithPassword(creds);
      if (signIn.error) throw signIn.error;
      localStorage.setItem(GUEST_KEY, JSON.stringify(creds));
      await register({ data: { displayName, isGuest: true } });
    },
    [register],
  );

  const signOut = useCallback(async () => {
    localStorage.removeItem(GUEST_KEY);
    await supabase.auth.signOut();
  }, []);

  return { userId, ready, signInAsGuest, signOut };
}

/** Realtime-driven authoritative room state. The client never computes results. */
export function useRoomState(code: string, enabled: boolean) {
  const getState = useServerFn(getRoomStateFn);
  const beat = useServerFn(heartbeatFn);
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionState>("SYNCHRONIZING");
  const codeRef = useRef(code);
  codeRef.current = code;

  const query = useQuery<RoomStateView>({
    queryKey: ["room", code],
    queryFn: () => getState({ data: { code } }),
    enabled,
    retry: 1,
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`room:${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_events" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["room", code] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_participants" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["room", code] });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnection("CONNECTED");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnection("RECONNECTING");
        else if (status === "CLOSED") setConnection("DISCONNECTED");
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [code, enabled, queryClient]);

  // Presence heartbeat + tab lifecycle → reconnect-safe sessions.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const ping = (connected: boolean) => {
      void beat({ data: { code: codeRef.current, connected } }).catch(() => undefined);
    };
    ping(true);
    const timer = window.setInterval(() => alive && ping(true), 20000);
    const onVisibility = () => ping(document.visibilityState === "visible");
    const onOffline = () => setConnection("DISCONNECTED");
    const onOnline = () => {
      setConnection("SYNCHRONIZING");
      ping(true);
      void queryClient.invalidateQueries({ queryKey: ["room", code] });
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      ping(false);
    };
  }, [beat, code, enabled, queryClient]);

  return { ...query, connection };
}
