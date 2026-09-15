# Notebook Arena

Build FACE-OFF as a production-oriented multiplayer game platform, not a mockup. Start with one complete vertical slice and architect for expansion. Product identity: hand-drawn competitive notebook + arcade scoreboard + controlled chaos; mobile-first, strong contrast, tactile controls, restrained purposeful motion, no generic AI-dashboard styling, no excessive gradients/glassmorphism/rounded-card spam, no emoji as primary icons. Core architecture: server-authoritative gameplay; client sends intent only; backend owns score/results/game state; realtime synchronization via WebSockets; persistent match state and reconnect-safe sessions. Roles: normal player/guest, spectator, tournament operator with granular permissions, and Master with highest authority. Every privileged command must authenticate, authorize, validate, execute, audit, then broadcast. Never rely on hidden UI for security. First game: RPS v1.0.0, exactly 2 players, first to 3; hidden choices until both submit; server resolves simultaneously; draw repeats round; match ends immediately at 3. Implement room lifecycle WAITING→READY→ROUND_STARTED→PLAYER_ACTIONS→RESOLVE→SCORE_UPDATE→NEXT_ROUND→MATCH_COMPLETE plus PAUSED/DISCONNECTED/RECONNECTING/CANCELLED/ABORTED/ERROR states. Build the vertical slice end-to-end: Player A → room → Player B → authoritative match server → RPS engine → realtime score → spectator view with hidden-info privacy → Master control with permission checks and audit log → reconnect/persistence → tests. Establish reusable Game Contract and Game Registry so future games are modules, not scattered conditionals. Include game manifest/capabilities/versioning, match engine abstraction, permissions model, audit events, notifications, loading/error/connection states, and responsive UI. Master controls should be capability/permission-derived and include START, PAUSE, RESUME, FORCE RESULT/ROUND, ADJUST SCORE, ELIMINATE/RESTORE, END/RESTART where applicable; all overrides audited. Spectators must never receive hidden choices before reveal. Add clear UI states CONNECTED/DISCONNECTED/RECONNECTING/SYNCHRONIZING. Use a central design-token system and reusable components. Do not implement fake tournament, AutoPilot, payments, subscriptions, ads, analytics, or future-game buttons yet; leave clean extension points only. Preserve a coherent architecture and document key decisions. Before broadening scope, verify the vertical slice actually works and fix integration gaps. Do not ask unnecessary questions; make sensible architecture decisions and report what was built and what remains.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://arcade-chaos-club.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/60472404-1c9e-49b0-8594-892ede06be2b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
