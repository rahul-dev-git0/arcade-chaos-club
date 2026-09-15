import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  createRoomFn,
  joinRoomFn,
  runCommandFn,
  submitActionFn,
} from "@/lib/faceoff/rooms.functions";
import { useRoomState, useSession } from "@/lib/faceoff/useFaceOff";
import type { ParticipantView, RoomStateView } from "@/lib/faceoff/types";

function getRoomFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
}

function goToRoom(code: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code.toUpperCase());
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const capabilityLabels: Record<string, string> = {
  START: "START",
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  END_MATCH: "END",
  RESTART_MATCH: "RESTART",
};

export function FaceOffApp() {
  const session = useSession();
  const [room, setRoom] = useState(getRoomFromUrl);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState(room);
  const [error, setError] = useState("");
  const createRoom = useServerFn(createRoomFn);
  const joinRoom = useServerFn(joinRoomFn);

  if (!session.ready) return <Loading />;

  if (!session.userId) {
    return (
      <Shell>
        <Landing
          name={name}
          setName={setName}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          error={error}
          onEnter={async () => {
            setError("");
            if (!name.trim()) return setError("Enter a player name.");
            try {
              await session.signInAsGuest(name.trim());
              const code = joinCode.trim();
              if (code) {
                await joinRoom({ data: { code, spectate: false } });
                setRoom(code.toUpperCase());
                goToRoom(code);
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not start a session.");
            }
          }}
          onCreate={async () => {
            setError("");
            if (!name.trim()) return setError("Enter a player name.");
            try {
              await session.signInAsGuest(name.trim());
              const result = await createRoom({ data: { gameSlug: "rps" } });
              setRoom(result.code);
              setJoinCode(result.code);
              goToRoom(result.code);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not create the room.");
            }
          }}
        />
      </Shell>
    );
  }

  if (!room) {
    return (
      <Shell>
        <Home
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          error={error}
          onJoin={async (spectate) => {
            setError("");
            const code = joinCode.trim().toUpperCase();
            if (!code) return setError("Enter a room code.");
            try {
              await joinRoom({ data: { code, spectate } });
              setRoom(code);
              goToRoom(code);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not join the room.");
            }
          }}
          onCreate={async () => {
            setError("");
            try {
              const result = await createRoom({ data: { gameSlug: "rps" } });
              setRoom(result.code);
              setJoinCode(result.code);
              goToRoom(result.code);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not create the room.");
            }
          }}
        />
      </Shell>
    );
  }

  return <RoomView code={room} displayName={name} />;
}

function RoomView({ code }: { code: string; displayName: string }) {
  const state = useRoomState(code, true);
  const command = useServerFn(runCommandFn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sendCommand = async (type: "START" | "PAUSE" | "RESUME" | "END_MATCH" | "RESTART_MATCH") => {
    setBusy(true);
    setError("");
    try {
      await command({ data: { code, command: { type } } });
      await state.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Command rejected by the server.");
    } finally {
      setBusy(false);
    }
  };

  if (state.isLoading || !state.data) return <Loading roomCode={code} />;
  const roomState = state.data;

  return (
    <Shell>
      <header className="fo-topbar">
        <a className="fo-brand" href="/" aria-label="FACE-OFF home">
          <span className="fo-brand-mark">F/O</span>
          <span>FACE-OFF</span>
        </a>
        <div className="fo-topbar-right">
          <span className={`fo-connection ${state.connection.toLowerCase()}`}>{state.connection}</span>
          <span className="fo-room-chip">ROOM <b>{code}</b></span>
        </div>
      </header>
      {error && <div className="fo-error">{error}</div>}
      {roomState.room.status === "WAITING" || roomState.room.status === "READY" ? (
        <Lobby state={roomState} busy={busy} onCommand={sendCommand} />
      ) : (
        <Match state={roomState} busy={busy} onCommand={sendCommand} />
      )}
    </Shell>
  );
}

function Lobby({
  state,
  busy,
  onCommand,
}: {
  state: RoomStateView;
  busy: boolean;
  onCommand: (type: "START" | "PAUSE" | "RESUME" | "END_MATCH" | "RESTART_MATCH") => Promise<void>;
}) {
  const players = state.participants.filter((p) => p.role === "player");
  const spectators = state.participants.filter((p) => p.role === "spectator");
  const canStart = state.viewer.capabilities.includes("START");
  return (
    <main className="fo-page fo-lobby">
      <section className="fo-hero-grid">
        <div>
          <p className="fo-kicker">PUBLIC GAMEPLAY / RPS 01</p>
          <h1>READY.<br /><span>SET.</span><br />THROW.</h1>
          <p className="fo-lede">Two players. Hidden hands. First to three. The server decides every result.</p>
        </div>
        <div className="fo-code-board">
          <span>ROOM CODE</span>
          <strong>{state.room.code}</strong>
          <small>Share this code to bring someone in.</small>
        </div>
      </section>

      <section className="fo-panel">
        <div className="fo-panel-head">
          <div><span className="fo-kicker">LOBBY</span><h2>Players on deck</h2></div>
          <span className="fo-status">{players.length}/{state.game.maxPlayers} PLAYERS</span>
        </div>
        <div className="fo-roster">
          {[0, 1].map((seat) => {
            const player = players.find((p) => p.seat === seat);
            return <PlayerRow key={seat} player={player} seat={seat} />;
          })}
        </div>
        {spectators.length > 0 && (
          <div className="fo-spectators"><span>SPECTATORS</span>{spectators.map((p) => <b key={p.userId}>{p.displayName}</b>)}</div>
        )}
        <div className="fo-panel-actions">
          <div className="fo-rule-note">{players.length < 2 ? "Waiting for another player…" : "Both players ready. Start when you mean it."}</div>
          {canStart && (
            <button className="fo-button fo-button-primary" disabled={busy || players.length < state.game.minPlayers} onClick={() => void onCommand("START")}>
              START MATCH <span>→</span>
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function Match({
  state,
  busy,
  onCommand,
}: {
  state: RoomStateView;
  busy: boolean;
  onCommand: (type: "START" | "PAUSE" | "RESUME" | "END_MATCH" | "RESTART_MATCH") => Promise<void>;
}) {
  const submit = useServerFn(submitActionFn);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const me = state.participants.find((p) => p.userId === state.viewer.userId);
  const opponent = state.participants.find((p) => p.role === "player" && p.userId !== state.viewer.userId);
  const round = state.round;
  const canPlay = state.viewer.isPlayer && !state.viewer.hasSubmitted && state.room.status === "PLAYER_ACTIONS";
  const terminal = state.room.status === "MATCH_COMPLETE" || state.room.status === "CANCELLED" || state.room.status === "ABORTED";

  const choose = async (move: string) => {
    setSubmitting(true);
    setError("");
    try {
      await submit({ data: { code: state.room.code, move } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The server rejected that move.");
    } finally {
      setSubmitting(false);
    }
  };

  const controls = state.viewer.capabilities.filter((cap) => capabilityLabels[cap]);
  return (
    <main className="fo-page fo-match-page">
      <section className="fo-scoreboard">
        <div className="fo-score-player">
          <span className="fo-seat">PLAYER {me?.seat != null ? me.seat + 1 : "—"}</span>
          <strong>{me?.displayName ?? "YOU"}</strong>
          <em>{me?.score ?? 0}</em>
        </div>
        <div className="fo-score-middle">
          <span>ROUND {round?.number ?? state.room.currentRound}</span>
          <b>VS</b>
          <small>{state.room.status.replaceAll("_", " ")}</small>
        </div>
        <div className="fo-score-player fo-score-player-right">
          <span className="fo-seat">PLAYER {opponent?.seat != null ? opponent.seat + 1 : "—"}</span>
          <strong>{opponent?.displayName ?? "WAITING"}</strong>
          <em>{opponent?.score ?? 0}</em>
        </div>
      </section>

      <section className="fo-action-zone">
        <div className="fo-action-heading">
          <span className="fo-kicker">{terminal ? "MATCH COMPLETE" : "YOUR MOVE"}</span>
          <h1>{terminal ? "Final whistle." : canPlay ? "Choose your throw." : state.viewer.isSpectator ? "Spectator view." : "Hand locked."}</h1>
          <p>{round?.result?.summary ?? (state.viewer.hasSubmitted ? "Your choice is hidden. Waiting for the other player." : "Choose Rock, Paper or Scissors. Both hands reveal together.")}</p>
        </div>

        {error && <div className="fo-error">{error}</div>}
        <div className="fo-choice-grid">
          {state.actionOptions.map((option) => (
            <button
              key={option.value}
              className={`fo-choice ${!canPlay ? "is-locked" : ""}`}
              disabled={!canPlay || submitting}
              onClick={() => void choose(option.value)}
            >
              <span className="fo-choice-glyph">{option.glyph}</span>
              <b>{option.label}</b>
              <small>{option.beats ? `BEATS ${option.beats.toUpperCase()}` : ""}</small>
            </button>
          ))}
        </div>

        {round?.result && (
          <div className="fo-reveal">
            <span className="fo-kicker">SERVER REVEAL</span>
            <div>{Object.entries(round.result.reveal).map(([seat, move]) => <b key={seat}>P{Number(seat) + 1}: {move}</b>)}</div>
          </div>
        )}

        {controls.length > 0 && (
          <div className="fo-admin-strip">
            <span>AUTHORIZED CONTROLS</span>
            {state.viewer.capabilities.includes("PAUSE") && (state.room.status === "PAUSED" ? (
              <button disabled={busy} onClick={() => void onCommand("RESUME")}>RESUME</button>
            ) : <button disabled={busy || terminal} onClick={() => void onCommand("PAUSE")}>PAUSE</button>)}
            {state.viewer.capabilities.includes("END_MATCH") && <button disabled={busy || terminal} onClick={() => void onCommand("END_MATCH")}>END</button>}
            {state.viewer.capabilities.includes("RESTART_MATCH") && <button disabled={busy} onClick={() => void onCommand("RESTART_MATCH")}>RESTART</button>}
          </div>
        )}
      </section>
    </main>
  );
}

function PlayerRow({ player, seat }: { player?: ParticipantView; seat: number }) {
  return (
    <div className={`fo-player-row ${player ? "filled" : "empty"}`}>
      <span className="fo-player-seat">0{seat + 1}</span>
      <div><strong>{player?.displayName ?? "OPEN SLOT"}</strong><small>{player ? (player.connected ? "CONNECTED" : "RECONNECTING") : "Waiting for player"}</small></div>
      <b>{player ? "READY" : "—"}</b>
    </div>
  );
}

function Landing(props: {
  name: string; setName: (v: string) => void; joinCode: string; setJoinCode: (v: string) => void; error: string;
  onEnter: () => Promise<void>; onCreate: () => Promise<void>;
}) {
  return (
    <main className="fo-page fo-landing">
      <section className="fo-landing-copy">
        <p className="fo-kicker">THE COMPETITIVE CHAOS CLUB</p>
        <h1>PLAY<br /><span>LOUD.</span></h1>
        <p>Quick games. Real opponents. Server-locked results. No account required for simple free play.</p>
      </section>
      <section className="fo-entry-card">
        <div className="fo-card-label">ENTER THE ARENA</div>
        <label>PLAYER NAME<input value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="Your name" maxLength={32} /></label>
        <button className="fo-button fo-button-primary" onClick={() => void props.onCreate()}>CREATE RPS ROOM <span>→</span></button>
        <div className="fo-divider"><span>OR JOIN</span></div>
        <label>ROOM CODE<input value={props.joinCode} onChange={(e) => props.setJoinCode(e.target.value.toUpperCase())} placeholder="ABCD" maxLength={8} /></label>
        <div className="fo-two-buttons"><button className="fo-button" onClick={() => void props.onEnter()}>JOIN TO PLAY</button><button className="fo-button" onClick={async () => { if (!props.joinCode.trim()) return; await props.onEnter(); }}>JOIN</button></div>
        {props.error && <div className="fo-error">{props.error}</div>}
      </section>
    </main>
  );
}

function Home({ joinCode, setJoinCode, error, onJoin, onCreate }: { joinCode: string; setJoinCode: (v: string) => void; error: string; onJoin: (spectate: boolean) => Promise<void>; onCreate: () => Promise<void> }) {
  return (
    <main className="fo-page fo-home">
      <div><p className="fo-kicker">FACE-OFF / PUBLIC PLAY</p><h1>Pick a room.<br /><span>Pick a fight.</span></h1><p className="fo-lede">Everything that matters is decided on the server. You play; the engine keeps the score.</p></div>
      <section className="fo-panel fo-home-panel"><span className="fo-card-label">ROOM ACCESS</span><input className="fo-big-input" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={8} /><div className="fo-two-buttons"><button className="fo-button fo-button-primary" onClick={() => void onJoin(false)}>JOIN GAME</button><button className="fo-button" onClick={() => void onJoin(true)}>SPECTATE</button></div><button className="fo-text-button" onClick={() => void onCreate()}>+ CREATE A NEW RPS ROOM</button>{error && <div className="fo-error">{error}</div>}</section>
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="fo-shell"><div className="fo-paper-noise" />{children}</div>;
}

function Loading({ roomCode }: { roomCode?: string }) {
  return <Shell><main className="fo-page fo-loading"><span className="fo-brand-mark">F/O</span><h1>{roomCode ? `SYNCING ${roomCode}` : "LOADING FACE-OFF"}</h1><p>Connecting to the authoritative game server…</p></main></Shell>;
}
