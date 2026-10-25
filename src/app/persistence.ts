import {
  BrowserStorage, SaveManager, StorageGhostStore, scheduledSeed,
  type GhostRecording, type InputReplayData, type StorageAdapter,
} from "@slu/web-shell";
import { LeaderboardManager, type LeaderboardEntry, type LeaderboardProvider } from "@slu/web-shell/modules";
import type { RunConfig, StepInput } from "../sim/types.js";

export const GAME_ID = "dodge-arena-proto";

export interface SaveData {
  runs: number;
  firstRunDone: boolean;
  muted: boolean;
  /** Colorblind-safe palette. */
  colorblind?: boolean;
  /** Best score per board ("endless", "daily:YYYY-MM-DD"). */
  best: Record<string, number>;
  playerId: string;
}

const DEFAULT_SAVE = (): SaveData => ({
  runs: 0, firstRunDone: false, muted: false, best: {},
  playerId: `p-${Math.random().toString(36).slice(2, 10)}`,
});

/**
 * Leaderboard provider persisted through the shell StorageAdapter.
 * (The shell's LocalLeaderboardProvider is in-memory only — see SHELL_GAPS.md.)
 * Swap for a Vercel-backed provider by implementing the same interface.
 */
export class StorageLeaderboardProvider implements LeaderboardProvider {
  constructor(private readonly storage: StorageAdapter, private readonly keep = 50) {}
  private key(board: string) { return `lb:${board}`; }
  async submit(board: string, entry: LeaderboardEntry): Promise<void> {
    const list = (await this.storage.get<LeaderboardEntry[]>(this.key(board))) ?? [];
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    await this.storage.set(this.key(board), list.slice(0, this.keep));
  }
  async top(board: string, limit = 10): Promise<LeaderboardEntry[]> {
    return ((await this.storage.get<LeaderboardEntry[]>(this.key(board))) ?? []).slice(0, limit);
  }
}

export interface StoredReplay { config: RunConfig; data: InputReplayData<StepInput>; score: number }

export class Persistence {
  readonly storage = new BrowserStorage(GAME_ID);
  private readonly saves = new SaveManager<SaveData>(this.storage, "save", 1);
  readonly ghosts = new StorageGhostStore(this.storage, "ghost");
  readonly leaderboard = new LeaderboardManager(new StorageLeaderboardProvider(this.storage));
  data: SaveData = DEFAULT_SAVE();

  async load(): Promise<void> {
    try {
      const r = await this.saves.loadWithRecovery();
      if (r.data) this.data = { ...DEFAULT_SAVE(), ...r.data };
    } catch { /* corrupt save → defaults */ }
  }
  async save(): Promise<void> { try { await this.saves.save(this.data); } catch { /* storage full / private mode */ } }

  best(board: string): number { return this.data.best[board] ?? 0; }

  saveGhost(id: string, rec: GhostRecording): Promise<void> { return this.ghosts.save(id, rec).catch(() => {}); }
  loadGhost(id: string): Promise<GhostRecording | null> { return this.ghosts.load(id).catch(() => null); }
  saveReplay(board: string, r: StoredReplay): Promise<void> { return this.storage.set(`replay:${board}`, r).catch(() => {}); }
}

/** Board id + seed for a mode. Daily seeds come from the shell's scheduledSeed. */
export function boardFor(mode: "endless" | "daily", freshSeed: () => string): { board: string; seed: string } {
  if (mode === "daily") {
    const s = scheduledSeed(GAME_ID, "daily");
    return { board: s.key, seed: String(s.seed) };
  }
  return { board: "endless", seed: freshSeed() };
}
