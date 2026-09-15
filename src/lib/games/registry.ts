import type { GameEngine, GameManifest } from "./contract";
import { GameRuleError } from "./contract";
import { rpsEngine } from "./rps";

/**
 * Game Registry
 * -------------
 * Extension point: register a new game module here and the platform
 * (rooms, master controls, spectator view, audit) picks it up without
 * any conditionals elsewhere.
 */
const REGISTRY = new Map<string, GameEngine<never>>([
  [rpsEngine.manifest.slug, rpsEngine as GameEngine<never>],
]);

export function getEngine(slug: string, version?: string): GameEngine<never> {
  const engine = REGISTRY.get(slug);
  if (!engine) {
    throw new GameRuleError(`Unknown game "${slug}".`, "UNKNOWN_GAME");
  }
  if (version && version !== engine.manifest.version) {
    throw new GameRuleError(
      `Game "${slug}" is at version ${engine.manifest.version}; room requires ${version}.`,
      "GAME_VERSION_MISMATCH",
    );
  }
  return engine;
}

export function listManifests(): GameManifest[] {
  return [...REGISTRY.values()].map((engine) => engine.manifest);
}

export function getManifest(slug: string): GameManifest {
  return getEngine(slug).manifest;
}
