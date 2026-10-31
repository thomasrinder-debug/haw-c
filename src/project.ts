// Ermittelt aus der aktiven Datei, was gebaut wird: Makefile-Projekt, ganzer
// Ordner oder Einzeldatei. Dazu Ziele des Makefiles und Suche nach dem Programm.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Kit, run } from './kit';

const MAKEFILE_NAMES = ['GNUmakefile', 'makefile', 'Makefile'];

export type Project =
  | { kind: 'make'; dir: string }
  | { kind: 'folder'; dir: string; sources: string[]; main?: string }
  | { kind: 'file'; dir: string; sources: string[] };

const SOURCE_FOLDERS = ['src', 'include', 'lib'];

export function isC(file: string): boolean {
  return path.extname(file).toLowerCase() === '.c';
}

/** Sucht das nächstgelegene Makefile vom Ordner der Datei aufwärts bis zum Arbeitsbereich. */
export function findMakeDir(file: string): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
  const stop = folder?.uri.fsPath;
  let dir = path.dirname(file);
  for (;;) {
    if (MAKEFILE_NAMES.some((name) => fs.existsSync(path.join(dir, name)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (!stop || parent === dir || samePath(dir, stop)) {
      return undefined;
    }
    dir = parent;
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/** Liefert das Projekt zur aktiven Datei oder, ohne offene Datei, zum Arbeitsbereich. */
export function currentProject(): Project | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (uri?.scheme === 'file') {
    return projectFor(uri.fsPath);
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (MAKEFILE_NAMES.some((name) => fs.existsSync(path.join(folder.uri.fsPath, name)))) {
      return { kind: 'make', dir: folder.uri.fsPath };
    }
  }
  return undefined;
}

export function projectFor(file: string): Project | undefined {
  const makeDir = findMakeDir(file);
  if (makeDir) {
    return { kind: 'make', dir: makeDir };
  }
  const onlyActive = vscode.workspace
    .getConfiguration('hawC', vscode.Uri.file(file))
    .get<boolean>('nurAktiveDatei', false);
  if (onlyActive) {
    return isC(file) ? { kind: 'file', dir: path.dirname(file), sources: [file] } : undefined;
  }
  const dir = sourceRoot(file);
  const all = collectSources(dir);
  const mains = all.filter(hasMain);
  // Mehrere main: getrennte Programme in einem Ordner, etwa Übungsaufgaben. Dann
  // gehört die aktive Datei mit allen Dateien ohne main zusammen.
  let sources = all;
  if (mains.length > 1) {
    if (!mains.includes(file)) {
      return undefined;
    }
    sources = all.filter((source) => source === file || !mains.includes(source));
  }
  if (sources.length === 0) {
    return undefined;
  }
  return sources.length === 1
    ? { kind: 'file', dir, sources }
    : { kind: 'folder', dir, sources, main: mains.length > 1 ? file : undefined };
}

/** Wurzel des Projekts: bei Dateien in src, include oder lib der Ordner darüber. */
export function sourceRoot(file: string): string {
  const dir = path.dirname(file);
  return SOURCE_FOLDERS.includes(path.basename(dir).toLowerCase()) ? path.dirname(dir) : dir;
}

function collectSources(root: string): string[] {
  const sources: string[] = [];
  for (const dir of [root, path.join(root, 'src'), path.join(root, 'lib')]) {
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && isC(entry.name)) {
          sources.push(path.join(dir, entry.name));
        }
      }
    }
  }
  return sources.sort();
}

function hasMain(file: string): boolean {
  const code = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
  return /\bmain\s*\(/.test(code);
}

/** Include-Pfade relativ zur Wurzel, damit eigene Header ohne Pfadangabe gefunden werden. */
export function includeDirs(root: string): string[] {
  return ['.', 'include', 'src', 'lib'].filter((name) => fs.existsSync(path.join(root, name)));
}

/** Meldet, warum sich zur Datei kein Projekt bilden lässt. */
export function noProjectReason(file: string | undefined): string {
  if (!file || !/\.[ch]$/i.test(file)) {
    return 'Bitte zuerst eine .c-Datei öffnen.';
  }
  const mains = collectSources(sourceRoot(file)).filter(hasMain);
  if (mains.length > 1) {
    const names = mains.map((name) => path.basename(name)).join(', ');
    return `Hier gibt es mehrere Programme mit main (${names}). Bitte die Datei öffnen, die starten soll.`;
  }
  return 'Hier gibt es keine .c-Datei zum Übersetzen.';
}

export function hash(text: string): string {
  return crypto.createHash('sha1').update(text.toLowerCase()).digest('hex').slice(0, 12);
}

/** Pfad des Programms im Speicherbereich der Extension, der Projektordner bleibt sauber. */
export function outputFor(kit: Kit, project: Project): string {
  if (project.kind === 'make') {
    throw new Error('Bei Makefile-Projekten bestimmt das Makefile den Ablageort.');
  }
  const single = project.kind === 'file' ? project.sources[0] : project.main;
  const base = single ? path.basename(single, '.c') : path.basename(project.dir);
  const key = single ?? project.dir;
  return path.join(kit.buildDir, hash(key), `${base}.exe`);
}

/** Liest die Ziele des Makefiles aus der Datenbank von make. */
export async function makeTargets(kit: Kit, dir: string): Promise<string[]> {
  const { output } = await run(kit.tool('make'), ['-pRrq'], {
    cwd: dir,
    env: kit.env(),
    check: false,
  });
  const targets = new Set<string>();
  let notATarget = false;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('# Not a target')) {
      notATarget = true;
      continue;
    }
    const match = /^([A-Za-z0-9_][A-Za-z0-9_\-]*):(?!=)/.exec(line);
    if (match && !notATarget) {
      targets.add(match[1]);
    }
    notATarget = false;
  }
  return [...targets].filter((name) => !MAKEFILE_NAMES.includes(name)).sort();
}

/** Sucht die vom Makefile gebauten Programme, das zuletzt gebaute zuerst. */
export function findExecutables(dir: string, depth = 4): string[] {
  const found: { file: string; time: number }[] = [];
  const walk = (current: string, level: number) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (level > 0 && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walk(full, level - 1);
        }
      } else if (entry.name.toLowerCase().endsWith('.exe')) {
        found.push({ file: full, time: fs.statSync(full).mtimeMs });
      }
    }
  };
  walk(dir, depth);
  return found.sort((a, b) => b.time - a.time).map((item) => item.file);
}

/** Zerlegt eine Argumentzeile; Anführungszeichen halten Wörter zusammen. */
export function splitArgs(line: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    args.push(match[1] ?? match[2]);
  }
  return args;
}
