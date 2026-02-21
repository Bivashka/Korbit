import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { access, mkdir, readdir, stat } from 'fs/promises';
import { basename, isAbsolute, resolve, sep } from 'path';

export const SUPPORTED_BUILD_TARGETS = ['windows', 'android'] as const;
export type BuildTarget = (typeof SUPPORTED_BUILD_TARGETS)[number];
type BuildStatus = 'idle' | 'running' | 'success' | 'failed';

type BuildState = {
  target: BuildTarget;
  status: BuildStatus;
  runId: number;
  startedAt: string | null;
  finishedAt: string | null;
  initiatedBy: string | null;
  artifactName: string | null;
  artifactSize: number | null;
  artifactCreatedAt: string | null;
  artifactUrl: string | null;
  lastError: string | null;
  logTail: string[];
};

type BuildArtifact = {
  name: string;
  size: number;
  createdAt: string;
  url: string;
  target: BuildTarget | 'unknown';
};

const LOG_TAIL_LIMIT = 120;
const ALLOWED_ARTIFACT_EXTENSIONS = [
  '.apk',
  '.aab',
  '.exe',
  '.msi',
  '.zip',
  '.tar.gz',
  '.tgz',
];
const FALLBACK_WORKSPACE_ROOTS = ['/opt/korbit'];

@Injectable()
export class AdminBuildsService {
  private readonly logger = new Logger(AdminBuildsService.name);
  private readonly states = new Map<BuildTarget, BuildState>();

  constructor(private readonly configService: ConfigService) {
    for (const target of SUPPORTED_BUILD_TARGETS) {
      this.states.set(target, this.createInitialState(target));
    }
  }

  async getBuildOverview() {
    const artifacts = await this.listArtifacts();
    return {
      builds: SUPPORTED_BUILD_TARGETS.map((target) => this.cloneState(target)),
      artifacts,
      targets: [...SUPPORTED_BUILD_TARGETS],
    };
  }

  async triggerBuild(target: BuildTarget, userId: string) {
    const current = this.states.get(target);
    if (!current) {
      throw new BadRequestException('Unsupported build target');
    }
    if (current.status === 'running') {
      return this.cloneState(target);
    }

    const runId = current.runId + 1;
    this.states.set(target, {
      ...current,
      status: 'running',
      runId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      initiatedBy: userId,
      artifactName: null,
      artifactSize: null,
      artifactCreatedAt: null,
      artifactUrl: null,
      lastError: null,
      logTail: [],
    });

    void this.runBuild(target, runId);
    return this.cloneState(target);
  }

  private createInitialState(target: BuildTarget): BuildState {
    return {
      target,
      status: 'idle',
      runId: 0,
      startedAt: null,
      finishedAt: null,
      initiatedBy: null,
      artifactName: null,
      artifactSize: null,
      artifactCreatedAt: null,
      artifactUrl: null,
      lastError: null,
      logTail: [],
    };
  }

  private cloneState(target: BuildTarget): BuildState {
    const state = this.states.get(target) ?? this.createInitialState(target);
    return {
      ...state,
      logTail: [...state.logTail],
    };
  }

  private applyState(
    target: BuildTarget,
    runId: number,
    updater: (state: BuildState) => BuildState,
  ) {
    const current = this.states.get(target);
    if (!current || current.runId !== runId) {
      return;
    }
    this.states.set(target, updater(current));
  }

  private appendLog(target: BuildTarget, runId: number, line: string) {
    const normalized = line.trim();
    if (!normalized) {
      return;
    }
    this.applyState(target, runId, (current) => {
      const clipped =
        normalized.length > 700 ? `${normalized.slice(0, 697)}...` : normalized;
      const nextLog = [...current.logTail, clipped];
      if (nextLog.length > LOG_TAIL_LIMIT) {
        nextLog.splice(0, nextLog.length - LOG_TAIL_LIMIT);
      }
      return {
        ...current,
        logTail: nextLog,
      };
    });
  }

  private resolveReleaseDirectory() {
    const uploadDir = this.configService.get<string>('UPLOAD_DIR', 'uploads');
    return resolve(process.cwd(), uploadDir, 'releases');
  }

  private resolveReleasePublicPrefix() {
    const prefix = this.configService.get<string>('UPLOAD_PUBLIC_PREFIX', '/uploads');
    return `${prefix.replace(/\/$/, '')}/releases`;
  }

  private resolvePublicWebUrl() {
    const rawOrigins = this.configService.get<string>(
      'CORS_ORIGIN',
      'http://localhost:3000',
    );
    return rawOrigins.split(',')[0]?.trim() || 'http://localhost:3000';
  }

  private isWorkspaceRoot(pathValue: string) {
    return (
      existsSync(resolve(pathValue, 'pnpm-workspace.yaml')) &&
      existsSync(resolve(pathValue, 'scripts', 'release'))
    );
  }

  private resolveWorkspaceRoot() {
    const configuredRoot = this.configService.get<string>('KORBIT_BUILD_ROOT');
    if (configuredRoot?.trim()) {
      return this.resolveFromProcessRoot(configuredRoot.trim());
    }

    let cursor = process.cwd();
    while (true) {
      if (this.isWorkspaceRoot(cursor)) {
        return cursor;
      }

      const parent = resolve(cursor, '..');
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }

    for (const candidate of FALLBACK_WORKSPACE_ROOTS) {
      if (this.isWorkspaceRoot(candidate)) {
        return candidate;
      }
    }

    return process.cwd();
  }

  private resolveFromProcessRoot(pathValue: string) {
    return isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue);
  }

  private resolveScriptPath(
    target: BuildTarget,
    workspaceRoot = this.resolveWorkspaceRoot(),
  ) {
    const envKey =
      target === 'windows' ? 'BUILD_WINDOWS_SCRIPT' : 'BUILD_ANDROID_SCRIPT';
    const defaultPath =
      target === 'windows'
        ? 'scripts/release/build-windows.sh'
        : 'scripts/release/build-android.sh';
    const configured = this.configService.get<string>(envKey, defaultPath);
    return isAbsolute(configured) ? configured : resolve(workspaceRoot, configured);
  }

  private resolveArtifactPathFromLogs(rawPath: string, releaseDir: string) {
    if (isAbsolute(rawPath)) {
      return rawPath;
    }

    const candidates = [
      resolve(releaseDir, rawPath),
      resolve(process.cwd(), rawPath),
      resolve(this.resolveWorkspaceRoot(), rawPath),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  private toArtifactUrl(fileName: string) {
    return `${this.resolveReleasePublicPrefix()}/${encodeURIComponent(fileName)}`;
  }

  private guessArtifactTarget(fileName: string): BuildTarget | 'unknown' {
    const lowered = fileName.toLowerCase();
    if (lowered.includes('android') || lowered.includes('mobile')) {
      return 'android';
    }
    if (
      lowered.includes('windows') ||
      lowered.includes('win') ||
      lowered.includes('desktop')
    ) {
      return 'windows';
    }
    return 'unknown';
  }

  private isArtifactFile(fileName: string) {
    const lowered = fileName.toLowerCase();
    return ALLOWED_ARTIFACT_EXTENSIONS.some((extension) => lowered.endsWith(extension));
  }

  private async listArtifacts(): Promise<BuildArtifact[]> {
    const releaseDir = this.resolveReleaseDirectory();
    await mkdir(releaseDir, { recursive: true });
    const entries = await readdir(releaseDir, { withFileTypes: true });

    const artifacts: BuildArtifact[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !this.isArtifactFile(entry.name)) {
        continue;
      }
      const location = resolve(releaseDir, entry.name);
      const stats = await stat(location);
      artifacts.push({
        name: entry.name,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
        url: this.toArtifactUrl(entry.name),
        target: this.guessArtifactTarget(entry.name),
      });
    }

    artifacts.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
    return artifacts;
  }

  private async findLatestArtifactPath(
    releaseDir: string,
    target: BuildTarget,
    startedAtMs: number,
  ) {
    const entries = await readdir(releaseDir, { withFileTypes: true });
    let candidatePath: string | null = null;
    let candidateMtime = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !this.isArtifactFile(entry.name)) {
        continue;
      }
      const guessedTarget = this.guessArtifactTarget(entry.name);
      if (guessedTarget !== target) {
        continue;
      }
      const location = resolve(releaseDir, entry.name);
      const stats = await stat(location);
      const modifiedMs = stats.mtime.getTime();
      if (modifiedMs < startedAtMs || modifiedMs <= candidateMtime) {
        continue;
      }
      candidateMtime = modifiedMs;
      candidatePath = location;
    }

    return candidatePath;
  }

  private async runBuild(target: BuildTarget, runId: number) {
    const releaseDir = this.resolveReleaseDirectory();
    await mkdir(releaseDir, { recursive: true });
    const buildCwd = this.resolveWorkspaceRoot();

    const scriptPath = this.resolveScriptPath(target, buildCwd);
    try {
      await access(scriptPath);
    } catch {
      this.applyState(target, runId, (current) => ({
        ...current,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        lastError: `Build script not found: ${scriptPath}`,
      }));
      return;
    }

    const startedAtMs = Date.now();
    let artifactPathFromLogs: string | null = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const shellCommand =
      this.configService.get<string>('BUILD_SCRIPT_SHELL')?.trim() || 'bash';
    let spawnError: string | null = null;

    this.appendLog(
      target,
      runId,
      `[system] shell=${shellCommand} cwd=${buildCwd} script=${scriptPath}`,
    );

    const buildProcess = spawn(shellCommand, [scriptPath], {
      cwd: buildCwd,
      env: {
        ...process.env,
        KORBIT_BUILD_OUTPUT_DIR: releaseDir,
        KORBIT_BUILD_TARGET: target,
        KORBIT_PUBLIC_WEB_URL: this.resolvePublicWebUrl(),
        KORBIT_BUILD_ROOT: buildCwd,
        KORBIT_BUILD_RUN_ID: String(runId),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const consumeChunk = (
      chunk: Buffer,
      isErrorStream: boolean,
      isFinal = false,
    ) => {
      const text = chunk.toString('utf8');
      if (isErrorStream) {
        stderrBuffer += text;
      } else {
        stdoutBuffer += text;
      }

      const source = isErrorStream ? stderrBuffer : stdoutBuffer;
      const parts = source.split(/\r?\n/);
      const completeLines = isFinal ? parts : parts.slice(0, -1);
      const tail = isFinal ? '' : (parts[parts.length - 1] ?? '');

      for (const rawLine of completeLines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        if (!isErrorStream && line.startsWith('ARTIFACT_PATH=')) {
          artifactPathFromLogs = line.slice('ARTIFACT_PATH='.length).trim();
        }
        this.appendLog(target, runId, `${isErrorStream ? '[stderr]' : '[stdout]'} ${line}`);
      }

      if (isErrorStream) {
        stderrBuffer = tail;
      } else {
        stdoutBuffer = tail;
      }
    };

    buildProcess.stdout.on('data', (chunk: Buffer) => consumeChunk(chunk, false));
    buildProcess.stderr.on('data', (chunk: Buffer) => consumeChunk(chunk, true));

    const exitCode = await new Promise<number | null>((resolveExit) => {
      buildProcess.on('close', (code) => resolveExit(code));
      buildProcess.on('error', (error) => {
        spawnError = error instanceof Error ? error.message : String(error);
        this.appendLog(target, runId, `[system] spawn error: ${spawnError}`);
        resolveExit(-1);
      });
    });

    if (stdoutBuffer) {
      consumeChunk(Buffer.from(''), false, true);
    }
    if (stderrBuffer) {
      consumeChunk(Buffer.from(''), true, true);
    }

    if (exitCode !== 0) {
      this.applyState(target, runId, (current) => ({
        ...current,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        lastError: spawnError
          ? `Build failed: ${spawnError}`
          : `Build failed with exit code ${String(exitCode)}`,
      }));
      return;
    }

    let resolvedArtifactPath: string | null = artifactPathFromLogs
      ? this.resolveArtifactPathFromLogs(artifactPathFromLogs, releaseDir)
      : null;

    if (!resolvedArtifactPath) {
      resolvedArtifactPath = await this.findLatestArtifactPath(
        releaseDir,
        target,
        startedAtMs,
      );
    }

    if (!resolvedArtifactPath) {
      this.applyState(target, runId, (current) => ({
        ...current,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        lastError: 'Build finished but no artifact was produced',
      }));
      return;
    }

    const normalizedReleaseDir = `${releaseDir}${sep}`;
    if (
      resolvedArtifactPath !== releaseDir &&
      !resolvedArtifactPath.startsWith(normalizedReleaseDir)
    ) {
      this.applyState(target, runId, (current) => ({
        ...current,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        lastError: 'Artifact path is outside release directory',
      }));
      return;
    }

    try {
      const artifactStats = await stat(resolvedArtifactPath);
      const artifactName = basename(resolvedArtifactPath);
      this.applyState(target, runId, (current) => ({
        ...current,
        status: 'success',
        finishedAt: new Date().toISOString(),
        artifactName,
        artifactSize: artifactStats.size,
        artifactCreatedAt: artifactStats.mtime.toISOString(),
        artifactUrl: this.toArtifactUrl(artifactName),
        lastError: null,
      }));
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Unable to inspect artifact for ${target} build #${runId}: ${details}`,
      );
      this.applyState(target, runId, (current) => ({
        ...current,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        lastError: 'Build finished but artifact is not readable',
      }));
    }
  }
}
