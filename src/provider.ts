import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';

import { createDefaultProviderRegistry } from '@webstir-io/webstir-testing';
import type { ProviderRegistry, RunnerSummary, TestProvider, TestRuntime, TestRunResult } from '@webstir-io/webstir-testing';

interface VitestModuleResult {
  readonly filepath?: string;
  readonly result?: {
    readonly state?: string;
    readonly duration?: number;
  };
  readonly tasks?: readonly VitestTaskResult[];
}

interface VitestTaskResult {
  readonly type?: string;
  readonly name?: string;
  readonly mode?: string;
  readonly tasks?: readonly VitestTaskResult[];
  readonly result?: {
    readonly state?: string;
    readonly duration?: number;
    readonly errors?: readonly VitestTaskError[];
  };
}

interface VitestTaskError {
  readonly message?: string;
  readonly stack?: string;
  readonly stacks?: readonly { readonly message?: string; readonly stack?: string }[];
}

type StartVitestFn = (
  mode: string,
  filters?: readonly string[],
  options?: Record<string, unknown>,
  viteOverrides?: unknown,
  vitestOptions?: { stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream },
) => Promise<{
  state: {
    getFiles(): unknown[];
    getUnhandledErrors?(): unknown[];
  };
}>;

const require = createRequire(import.meta.url);

export function createProviderRegistry(): ProviderRegistry {
  const fallbackRegistry = createDefaultProviderRegistry();

  const vitestProvider: TestProvider = {
    id: '-io/vitest-testing/frontend',
    async runTests(files: readonly string[]) {
      if (files.length === 0) {
        return createEmptySummary();
      }

      const summary = await runVitest(files);
      if (summary.total > 0 && summary.results.some((result) => result.name !== '[vitest provider]')) {
        console.info('[webstir-io/vitest-testing] Vitest executed suite with %d result(s).', summary.total);
      }
      return summary;
    },
  };

  return {
    get(runtime: TestRuntime): TestProvider | null {
      if (runtime === 'frontend') {
        return vitestProvider;
      }

      return fallbackRegistry.get(runtime);
    },
  };
}

function createEmptySummary(): RunnerSummary {
  return {
    passed: 0,
    failed: 0,
    total: 0,
    durationMs: 0,
    results: [],
  };
}

function createFailureSummary(files: readonly string[], message: string): RunnerSummary {
  const normalizedMessage = message.trim();
  const results: TestRunResult[] = files.map((file) => ({
    name: '[vitest provider]',
    file,
    passed: false,
    message: normalizedMessage,
    durationMs: 0,
  }));

  if (results.length === 0) {
    results.push({
      name: '[vitest provider]',
      file: '[vitest]',
      passed: false,
      message: normalizedMessage,
      durationMs: 0,
    });
  }

  return {
    passed: 0,
    failed: results.length,
    total: results.length,
    durationMs: 0,
    results,
  };
}

async function runVitest(files: readonly string[]): Promise<RunnerSummary> {
  const vitestPackage = resolveVitestPackage();
  if (!vitestPackage) {
    const message = '[webstir-io/vitest-testing] Vitest runtime not installed. Install "vitest" in the active workspace or ensure it can be resolved.';
    console.warn(message);
    return createFailureSummary(files, message);
  }

  let startVitest: StartVitestFn | null = null;
  try {
    const vitestModulePath = path.resolve(path.dirname(vitestPackage), 'dist', 'node.js');
    const vitestModuleUrl = pathToFileURL(vitestModulePath).href;
    const vitestModule = (await import(vitestModuleUrl)) as Record<string, unknown>;
    const candidate = (vitestModule as { startVitest?: unknown }).startVitest;
    if (typeof candidate === 'function') {
      startVitest = candidate as StartVitestFn;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `[webstir-io/vitest-testing] Unable to load the Vitest runtime: ${reason}`;
    console.warn(message);
    return createFailureSummary(files, message);
  }

  if (!startVitest) {
    const message = '[webstir-io/vitest-testing] Unable to locate the Vitest startVitest export.';
    console.warn(message);
    return createFailureSummary(files, message);
  }

  const normalizedFiles = files.map((file) => path.resolve(file));
  const filters = normalizedFiles.map(normalizeCliFilter);

  const stdoutBuffer = new PassThrough();
  const stderrBuffer = new PassThrough();
  let stdout = '';
  let stderr = '';

  stdoutBuffer.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  stderrBuffer.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const originalProviderEnv = process.env.WEBSTIR_TEST_PROVIDER;
  const originalTestingProviderEnv = process.env.WEBSTIR_TESTING_PROVIDER;
  const originalSpecEnv = process.env.WEBSTIR_TESTING_PROVIDER_SPEC;

  process.env.WEBSTIR_TEST_PROVIDER = 'vitest';
  process.env.WEBSTIR_TESTING_PROVIDER = '@webstir-io/vitest-testing';
  process.env.WEBSTIR_TESTING_PROVIDER_SPEC = originalSpecEnv ?? '';

  const startTime = Date.now();

  try {
    const ctx = await startVitest(
      'test',
      filters,
      {
        run: true,
        watch: false,
        passWithNoTests: true,
        reporters: [],
        silent: true,
      },
      undefined,
      {
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
      },
    );

    stdoutBuffer.end();
    stderrBuffer.end();

    const summary = buildSummaryFromVitest(
      ctx.state.getFiles() as VitestModuleResult[],
      typeof ctx.state.getUnhandledErrors === 'function' ? ctx.state.getUnhandledErrors() : [],
      normalizedFiles,
    );

    const durationMs = summary.durationMs > 0 ? summary.durationMs : Date.now() - startTime;
    return summary.durationMs > 0 ? summary : { ...summary, durationMs };
  } catch (error) {
    stdoutBuffer.end();
    stderrBuffer.end();

    const reason = error instanceof Error ? `Vitest execution failed: ${error.message}` : 'Vitest execution failed.';
    const message = formatFailureMessage(reason, stdout, stderr);
    console.warn('[webstir-io/vitest-testing] %s', message);
    return createFailureSummary(files, message);
  } finally {
    if (typeof originalProviderEnv === 'string') {
      process.env.WEBSTIR_TEST_PROVIDER = originalProviderEnv;
    } else {
      delete process.env.WEBSTIR_TEST_PROVIDER;
    }

    if (typeof originalTestingProviderEnv === 'string') {
      process.env.WEBSTIR_TESTING_PROVIDER = originalTestingProviderEnv;
    } else {
      delete process.env.WEBSTIR_TESTING_PROVIDER;
    }

    if (typeof originalSpecEnv === 'string') {
      process.env.WEBSTIR_TESTING_PROVIDER_SPEC = originalSpecEnv;
    } else {
      delete process.env.WEBSTIR_TESTING_PROVIDER_SPEC;
    }
  }
}

function resolveVitestPackage(): string | null {
  try {
    return require.resolve('vitest/package.json');
  } catch {
    return null;
  }
}

function buildSummaryFromVitest(
  modules: readonly VitestModuleResult[] | undefined,
  unhandledErrors: readonly unknown[] | undefined,
  requestedFiles: readonly string[],
): RunnerSummary {
  const requestedSet = new Set(requestedFiles.map((file) => path.resolve(file)));
  const results: TestRunResult[] = [];
  let moduleDuration = 0;

  for (const moduleResult of modules ?? []) {
    const moduleFile = moduleResult.filepath ? path.resolve(moduleResult.filepath) : null;

    if (requestedSet.size > 0 && moduleFile && !requestedSet.has(moduleFile)) {
      continue;
    }

    if (moduleFile && typeof moduleResult.result?.duration === 'number') {
      moduleDuration += Math.max(0, moduleResult.result.duration);
    }

    if (moduleResult.tasks) {
      const targetFile = moduleFile ?? requestedFiles[0] ?? '[vitest]';
      collectTaskResults(moduleResult.tasks, targetFile, results);
    }
  }

  appendUnhandledErrors(unhandledErrors, requestedFiles, results);

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const durationFromTests = results.reduce((total, result) => total + Math.max(0, result.durationMs ?? 0), 0);
  const durationMs = durationFromTests > 0 ? durationFromTests : moduleDuration;

  return {
    passed,
    failed,
    total: results.length,
    durationMs,
    results,
  };
}

function collectTaskResults(tasks: readonly VitestTaskResult[], filePath: string, accumulator: TestRunResult[]): void {
  for (const task of tasks) {
    if (!task) {
      continue;
    }

    if (task.type === 'suite') {
      if (task.tasks) {
        collectTaskResults(task.tasks, filePath, accumulator);
      }
      continue;
    }

    if (task.tasks && task.tasks.length > 0 && task.type !== 'test') {
      collectTaskResults(task.tasks, filePath, accumulator);
      continue;
    }

    if (task.type !== 'test') {
      continue;
    }

    const state = task.result?.state ?? (task.mode === 'skip' || task.mode === 'todo' ? task.mode : undefined);
    const durationMs = typeof task.result?.duration === 'number' ? Math.max(0, task.result.duration) : 0;
    const name = task.name && task.name.trim().length > 0 ? task.name : '[unnamed]';
    const normalizedFile = filePath || '[vitest]';

    if (state === 'skip' || state === 'todo') {
      accumulator.push({
        name,
        file: normalizedFile,
        passed: true,
        message: null,
        durationMs,
      });
      continue;
    }

    const passed = state === 'pass';
    const errorMessage = formatTaskErrors(task.result?.errors);

    accumulator.push({
      name,
      file: normalizedFile,
      passed,
      message: passed ? null : errorMessage ?? 'Vitest reported a failure without additional details.',
      durationMs,
    });
  }
}

function appendUnhandledErrors(errors: readonly unknown[] | undefined, requestedFiles: readonly string[], results: TestRunResult[]): void {
  if (!errors || errors.length === 0) {
    return;
  }

  const targetFile = requestedFiles[0] ?? '[vitest]';
  for (const error of errors) {
    results.push({
      name: '[unhandled]',
      file: targetFile,
      passed: false,
      message: formatUnhandledError(error),
      durationMs: 0,
    });
  }
}

function formatUnhandledError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack && error.stack.trim().length > 0 ? error.stack : error.message || 'Unhandled error';
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function formatTaskErrors(errors: readonly VitestTaskError[] | undefined): string | null {
  if (!errors || errors.length === 0) {
    return null;
  }

  const messages: string[] = [];

  for (const error of errors) {
    if (!error) {
      continue;
    }

    if (typeof error.message === 'string' && error.message.trim().length > 0) {
      messages.push(error.message.trim());
    }

    if (Array.isArray(error.stacks)) {
      for (const stack of error.stacks) {
        if (stack && typeof stack.message === 'string' && stack.message.trim().length > 0) {
          messages.push(stack.message.trim());
        } else if (stack && typeof stack.stack === 'string' && stack.stack.trim().length > 0) {
          messages.push(stack.stack.trim());
        }
      }
    } else if (typeof error.stack === 'string' && error.stack.trim().length > 0) {
      messages.push(error.stack.trim());
    }
  }

  const unique = messages.filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
  return unique.length > 0 ? unique.join('\n\n') : null;
}

function normalizeCliFilter(file: string): string {
  const relative = path.relative(process.cwd(), file);
  if (relative && !relative.startsWith('..')) {
    return relative;
  }

  return file;
}

function formatFailureMessage(reason: string, stdout: string, stderr: string): string {
  const sections: string[] = [reason.trim()];
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();

  if (trimmedStdout.length > 0) {
    sections.push(`[stdout]\n${trimmedStdout}`);
  }

  if (trimmedStderr.length > 0) {
    sections.push(`[stderr]\n${trimmedStderr}`);
  }

  return sections.join('\n\n');
}
