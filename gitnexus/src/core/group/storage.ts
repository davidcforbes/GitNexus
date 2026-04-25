import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ContractRegistry } from './types.js';

const CONTRACTS_FILE = 'contracts.json';

export function getDefaultGitnexusDir(): string {
  return process.env.GITNEXUS_HOME || path.join(os.homedir(), '.gitnexus');
}

export function getGroupsBaseDir(gitnexusDir?: string): string {
  return path.join(gitnexusDir || getDefaultGitnexusDir(), 'groups');
}

const GROUP_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function validateGroupName(name: string): void {
  if (!GROUP_NAME_RE.test(name)) {
    throw new Error(
      `Invalid group name "${name}". Names must start with a letter or digit and contain only [a-zA-Z0-9_-].`,
    );
  }
}

export function getGroupDir(gitnexusDir: string, groupName: string): string {
  validateGroupName(groupName);
  return path.join(gitnexusDir, 'groups', groupName);
}

export async function writeContractRegistry(
  groupDir: string,
  registry: ContractRegistry,
): Promise<void> {
  const targetPath = path.join(groupDir, CONTRACTS_FILE);
  // Per-process suffix so concurrent writers don't collide on the temp
  // path itself (was Date.now() only — same-millisecond collisions
  // possible on fast hardware). (GitNexus-g09)
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  try {
    await fsp.writeFile(tmpPath, JSON.stringify(registry, null, 2), 'utf-8');
    await fsp.rename(tmpPath, targetPath);
  } catch (err) {
    // GitNexus-g09: if writeFile succeeded but rename failed (cross-device
    // EXDEV, EPERM under Windows AV, etc.), the .tmp file would have
    // leaked indefinitely. Best-effort unlink so failed syncs don't
    // accumulate disk usage in .gitnexus/groups/<name>/.
    await fsp.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export async function readContractRegistry(groupDir: string): Promise<ContractRegistry | null> {
  const filePath = path.join(groupDir, CONTRACTS_FILE);
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ContractRegistry;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function listGroups(gitnexusDir?: string): Promise<string[]> {
  const groupsDir = getGroupsBaseDir(gitnexusDir);
  try {
    const entries = await fsp.readdir(groupsDir, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const yamlPath = path.join(groupsDir, entry.name, 'group.yaml');
        if (fs.existsSync(yamlPath)) {
          names.push(entry.name);
        }
      }
    }
    return names;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function createGroupDir(
  gitnexusDir: string,
  groupName: string,
  force: boolean = false,
): Promise<string> {
  const groupDir = getGroupDir(gitnexusDir, groupName);
  if (fs.existsSync(path.join(groupDir, 'group.yaml')) && !force) {
    throw new Error(`Group "${groupName}" already exists. Use --force to overwrite.`);
  }
  await fsp.mkdir(groupDir, { recursive: true });

  const template = `version: 1
name: ${groupName}
description: ""

repos: {}

links: []

packages: {}

detect:
  http: true
  grpc: true
  topics: true
  shared_libs: true
  embedding_fallback: true

matching:
  bm25_threshold: 0.7
  embedding_threshold: 0.65
  max_candidates_per_step: 3
`;
  await fsp.writeFile(path.join(groupDir, 'group.yaml'), template, 'utf-8');
  return groupDir;
}
