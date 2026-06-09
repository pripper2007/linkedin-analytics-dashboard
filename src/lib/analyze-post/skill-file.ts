// Loads the writing-coach skill file from disk and computes a stable
// hash. The hash is stored alongside each cached analysis so the page
// can show "skill updated since last analysis" when the file has
// drifted.
//
// Server-only — uses fs. Memoized per-process: the file rarely changes
// during the lifetime of a Vercel Function instance, but if it does we
// re-read on every request. Cheap (~140 lines).

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SKILL_PATH = path.join(
  process.cwd(),
  'skills',
  'example-linkedin-writer.md',
);

export interface SkillFile {
  /** Full markdown content (sent verbatim into the system prompt). */
  content: string;
  /** SHA-256 of the file content, hex. */
  hash: string;
}

let cached: { mtimeMs: number; skill: SkillFile } | null = null;

export async function loadSkillFile(): Promise<SkillFile> {
  const stat = await fs.stat(SKILL_PATH);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.skill;
  const content = await fs.readFile(SKILL_PATH, 'utf8');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  cached = { mtimeMs: stat.mtimeMs, skill: { content, hash } };
  return cached.skill;
}
