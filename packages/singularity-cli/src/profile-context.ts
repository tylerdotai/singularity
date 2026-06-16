// Singularity CLI — shared helpers for opening the active profile's state.db.
// Used by the wired CLI commands (memory, profile, skills, doctor) to
// reach the SQLite-backed stores that the rest of the harness uses.

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  FactStore,
  type ProfilePath,
  ProfileResolver,
  ProfileStore,
  SessionStore,
  SkillRegistry,
} from 'singularity-core';

export interface ProfileContext {
  readonly path: ProfilePath;
  readonly db: Database;
  readonly factStore: FactStore;
  readonly sessionStore: SessionStore;
  readonly profileStore: ProfileStore;
  readonly skillRegistry: SkillRegistry;
  close(): void;
}

function safeMigrate(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes('already exists')) return;
    if (msg.includes('no such column')) return;
    throw e;
  }
}

export function singularityHome(): string {
  return process.env.SINGULARITY_HOME ?? join(homedir(), '.singularity');
}

export async function openDefaultProfile(): Promise<ProfileContext> {
  const resolver = new ProfileResolver();
  const path = await resolver.resolveDefault();
  const db = new Database(path.stateDbPath);
  const factStore = new FactStore(db);
  const sessionStore = new SessionStore(db);
  const profileStore = new ProfileStore(db);
  safeMigrate('facts', () => factStore.migrate());
  safeMigrate('profiles', () => profileStore.migrate());
  const skillRegistry = new SkillRegistry();
  return {
    path,
    db,
    factStore,
    sessionStore,
    profileStore,
    skillRegistry,
    close() {
      db.close();
    },
  };
}

export function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
