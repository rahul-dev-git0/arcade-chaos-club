
CREATE TYPE public.app_role AS ENUM ('master','operator','player');
CREATE TYPE public.room_status AS ENUM ('WAITING','READY','ROUND_STARTED','PLAYER_ACTIONS','RESOLVE','SCORE_UPDATE','NEXT_ROUND','MATCH_COMPLETE','PAUSED','DISCONNECTED','RECONNECTING','CANCELLED','ABORTED','ERROR');
CREATE TYPE public.participant_role AS ENUM ('player','spectator');
CREATE TYPE public.round_status AS ENUM ('PENDING','OPEN','RESOLVED','VOIDED');

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  is_guest BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by signed in users" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- game registry
CREATE TABLE public.games (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  tagline TEXT,
  min_players INT NOT NULL,
  max_players INT NOT NULL,
  supports_spectators BOOLEAN NOT NULL DEFAULT true,
  hidden_actions BOOLEAN NOT NULL DEFAULT false,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.games TO authenticated, anon;
GRANT ALL ON public.games TO service_role;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "games are public" ON public.games FOR SELECT USING (true);

INSERT INTO public.games (slug, name, version, tagline, min_players, max_players, supports_spectators, hidden_actions, capabilities, default_config, manifest)
VALUES (
  'rps', 'Rock Paper Scissors', '1.0.0', 'Best of five nerves. First to three.',
  2, 2, true, true,
  '["START","PAUSE","RESUME","FORCE_ROUND_RESULT","ADJUST_SCORE","ELIMINATE","RESTORE","END_MATCH","RESTART_MATCH","CANCEL_ROOM"]'::jsonb,
  '{"targetScore":3}'::jsonb,
  '{"engine":"rps","engineVersion":"1.0.0","simultaneous":true,"drawRepeatsRound":true}'::jsonb
);

-- rooms
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  game_slug TEXT NOT NULL REFERENCES public.games(slug),
  game_version TEXT NOT NULL,
  status public.room_status NOT NULL DEFAULT 'WAITING',
  previous_status public.room_status,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_round INT NOT NULL DEFAULT 0,
  winner_user_id UUID,
  created_by UUID NOT NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rooms readable by signed in users" ON public.rooms FOR SELECT TO authenticated USING (true);
CREATE TRIGGER rooms_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- participants
CREATE TABLE public.room_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.participant_role NOT NULL DEFAULT 'player',
  seat INT,
  score INT NOT NULL DEFAULT 0,
  eliminated BOOLEAN NOT NULL DEFAULT false,
  connected BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
CREATE UNIQUE INDEX room_seat_unique ON public.room_participants (room_id, seat) WHERE seat IS NOT NULL;
GRANT SELECT ON public.room_participants TO authenticated;
GRANT ALL ON public.room_participants TO service_role;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants readable by signed in users" ON public.room_participants FOR SELECT TO authenticated USING (true);
CREATE TRIGGER participants_updated_at BEFORE UPDATE ON public.room_participants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- rounds
CREATE TABLE public.rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  status public.round_status NOT NULL DEFAULT 'OPEN',
  result JSONB,
  forced BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (room_id, round_number)
);
GRANT SELECT ON public.rounds TO authenticated;
GRANT ALL ON public.rounds TO service_role;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rounds readable by signed in users" ON public.rounds FOR SELECT TO authenticated USING (true);

-- hidden actions
CREATE TABLE public.round_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  action JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id)
);
GRANT SELECT ON public.round_actions TO authenticated;
GRANT ALL ON public.round_actions TO service_role;
ALTER TABLE public.round_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "only own hidden action is readable" ON public.round_actions FOR SELECT TO authenticated USING (user_id = auth.uid());

-- public event feed (safe for spectators)
CREATE TABLE public.match_events (
  id BIGSERIAL PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX match_events_room_idx ON public.match_events (room_id, id DESC);
GRANT SELECT ON public.match_events TO authenticated;
GRANT ALL ON public.match_events TO service_role;
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events readable by signed in users" ON public.match_events FOR SELECT TO authenticated USING (true);

-- audit log
CREATE TABLE public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
  actor_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_user_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result TEXT NOT NULL DEFAULT 'OK',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_room_idx ON public.audit_log (room_id, id DESC);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit readable by master and operator" ON public.audit_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'master') OR public.has_role(auth.uid(),'operator'));

ALTER TABLE public.match_events REPLICA IDENTITY FULL;
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_participants REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_participants;
