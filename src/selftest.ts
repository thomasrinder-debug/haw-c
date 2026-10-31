// Selbsttest für Aufgaben: Die Datei aufgabe.json beschreibt Eingaben und erwartete
// Ausgaben. Der Vergleich lehnt sich an den Klausur-Grader an (letzte Zahl, Toleranz).
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { decode } from './kit';

export const TASK_FILE = 'aufgabe.json';

export interface TaskTest {
  name?: string;
  input?: string;
  erwartet: string;
}

export interface Task {
  name?: string;
  timeout_sec?: number;
  /** letzteZahl wie in der Klausur, zahlen für alle Zahlen, text für den genauen Wortlaut. */
  vergleich?: 'letzteZahl' | 'zahlen' | 'text';
  /** Absolute Toleranz; ohne Angabe wie im Grader 0,2 absolut oder 5 % relativ. */
  toleranz?: number;
  tests: TaskTest[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  problem?: string;
}

export function readTask(dir: string): Task | undefined {
  const file = path.join(dir, TASK_FILE);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  let task: Task;
  try {
    task = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${TASK_FILE} ist kein gültiges JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (!Array.isArray(task.tests) || task.tests.length === 0) {
    throw new Error(`${TASK_FILE} enthält keine Tests.`);
  }
  return task;
}

function numbers(text: string): string[] {
  return text.match(/[-+]?\d*\.\d+|[-+]?\d+/g) ?? [];
}

function sameNumber(actual: string, expected: string, tolerance?: number): boolean {
  const a = Number(actual);
  const e = Number(expected);
  const difference = Math.abs(a - e);
  if (tolerance !== undefined) {
    return difference <= tolerance;
  }
  return difference < 0.2 || (e !== 0 && difference / Math.abs(e) < 0.05);
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

export function matches(actual: string, expected: string, task: Pick<Task, 'vergleich' | 'toleranz'>): boolean {
  const mode = task.vergleich ?? 'letzteZahl';
  if (mode === 'text') {
    return normalizeText(actual) === normalizeText(expected);
  }
  const got = numbers(actual);
  const want = numbers(expected);
  if (mode === 'zahlen') {
    return got.length === want.length && got.every((value, i) => sameNumber(value, want[i], task.toleranz));
  }
  return got.length > 0 && want.length > 0 && sameNumber(got[got.length - 1], want[want.length - 1], task.toleranz);
}

/** Läuft ein Programm mit Eingabe und Zeitlimit; bewertet wird wie im Grader nur stdout. */
function execute(
  file: string,
  input: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  seconds: number,
): Promise<{ output: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(file, [], { cwd, env, windowsHide: true });
    const chunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, seconds * 1000);
    child.stdout.on('data', (data: Buffer) => chunks.push(data));
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ output: decode(Buffer.concat(chunks)), code, timedOut });
    });
    child.stdin.end(input);
  });
}

export async function runTests(
  file: string,
  task: Task,
  cwd: string,
  env: NodeJS.ProcessEnv,
  crashText: (code: number) => string | undefined,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const [index, test] of task.tests.entries()) {
    const input = test.input ?? '';
    const { output, code, timedOut } = await execute(file, input, cwd, env, task.timeout_sec ?? 2);
    const unsigned = (code ?? 0) >>> 0;
    let problem: string | undefined;
    if (timedOut) {
      problem = `Zeitlimit überschritten (${task.timeout_sec ?? 2} s): Endlosschleife, oder wartet das Programm auf mehr Eingaben?`;
    } else if (crashText(unsigned)) {
      problem = `Abgestürzt: ${crashText(unsigned)}.`;
    }
    results.push({
      name: test.name ?? `Test ${index + 1}`,
      passed: !problem && matches(output, test.erwartet, task),
      input,
      expected: test.erwartet,
      actual: output,
      problem,
    });
  }
  return results;
}

export function formatResults(task: Task, results: TestResult[]): string {
  const passed = results.filter((result) => result.passed).length;
  const lines = [`${task.name ?? 'Aufgabe'}: ${passed} von ${results.length} Tests bestanden`, ''];
  const mode = task.vergleich ?? 'letzteZahl';
  const modeText = {
    letzteZahl: 'Verglichen wird die letzte Zahl der Ausgabe.',
    zahlen: 'Verglichen werden alle Zahlen der Ausgabe.',
    text: 'Verglichen wird der genaue Wortlaut.',
  }[mode];
  lines.push(modeText, '');
  for (const result of results) {
    lines.push(`${result.passed ? '✓' : '✗'} ${result.name}`);
    if (!result.passed) {
      lines.push(`    Eingabe:  ${JSON.stringify(result.input)}`);
      lines.push(`    Erwartet: ${result.expected}`);
      lines.push(`    Ausgabe:  ${result.actual.trim() || '(keine)'}`);
      if (result.problem) {
        lines.push(`    ${result.problem}`);
      }
    }
  }
  return lines.join('\n');
}
