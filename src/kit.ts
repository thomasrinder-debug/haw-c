// Verwaltet das w64devkit im Speicherbereich der Extension: entpacken, Umgebung
// der Prozesse setzen, Starter übersetzen. Außerhalb dieses Bereichs wird nichts
// verändert, kein globaler PATH, keine Registry.
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const KIT_VERSION = '2.11.0';
const SFX_NAME = `w64devkit-x64-${KIT_VERSION}.7z.exe`;
const MEMORY_VERSION = 1;

export class Kit {
  private ready: Promise<void> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get storage(): string {
    return this.context.globalStorageUri.fsPath;
  }
  get root(): string {
    return path.join(this.storage, `w64devkit-${KIT_VERSION}`);
  }
  get bin(): string {
    return path.join(this.root, 'bin');
  }
  get buildDir(): string {
    return path.join(this.storage, 'build');
  }
  get compdbDir(): string {
    return path.join(this.storage, 'compdb');
  }
  get starter(): string {
    return path.join(this.storage, 'haw-start.exe');
  }
  get libs(): string {
    return path.join(this.storage, 'haw-c-libs');
  }
  tool(name: string): string {
    return path.join(this.bin, `${name}.exe`);
  }

  /** Richtet die Umgebung beim ersten Aufruf ein. Mehrfache Aufrufe warten auf denselben Lauf. */
  ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = this.setup().catch((error) => {
        this.ready = undefined;
        throw error;
      });
    }
    return this.ready;
  }

  /** Linker-Vorgaben der Speicherprüfung. Ohne Pfad ohne Leerzeichen geht es nicht. */
  get memorySpecs(): string {
    return path.join(this.storage, `haw-speicher-${MEMORY_VERSION}.specs`);
  }
  get memoryReport(): string {
    return path.join(shortPath(this.storage), 'speicher-bericht.txt');
  }
  get memoryAvailable(): boolean {
    return fs.existsSync(this.memorySpecs) && !shortPath(this.memorySpecs).includes(' ');
  }

  private isComplete(): boolean {
    return fs.existsSync(this.tool('gcc')) && fs.existsSync(this.starter) && fs.existsSync(this.memorySpecs);
  }

  private async setup(): Promise<void> {
    if (this.isComplete()) {
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'HAW Kiel C wird einmalig eingerichtet …' },
      async () => {
        await fs.promises.mkdir(this.storage, { recursive: true });
        if (!fs.existsSync(this.tool('gcc'))) {
          await this.extract();
        }
        await this.buildStarter();
        await this.removeOldVersions();
      },
    );
  }

  private async extract(): Promise<void> {
    const sfx = path.join(this.context.extensionPath, 'kit', SFX_NAME);
    const temp = `${this.root}.neu`;
    await fs.promises.rm(temp, { recursive: true, force: true });
    await fs.promises.mkdir(temp, { recursive: true });
    await run(sfx, ['-y', `-o${temp}`], { cwd: this.storage });
    const extracted = path.join(temp, 'w64devkit');
    // Die 32-Bit-Bibliotheken braucht der Kurs nicht, sie belegen über 100 MB.
    await fs.promises.rm(path.join(extracted, 'lib32'), { recursive: true, force: true });
    await fs.promises.rm(this.root, { recursive: true, force: true });
    await fs.promises.rename(extracted, this.root);
    await fs.promises.rm(temp, { recursive: true, force: true });
  }

  private async buildStarter(): Promise<void> {
    const source = path.join(this.context.extensionPath, 'starter', 'haw-start.c');
    await run(this.tool('gcc'), ['-O1', '-s', '-o', this.starter, source], { env: this.env() });

    const memorySource = path.join(this.context.extensionPath, 'starter', 'haw-speicher.c');
    const memoryObject = path.join(this.storage, `haw-speicher-${MEMORY_VERSION}.o`);
    await run(this.tool('gcc'), ['-O1', '-c', '-o', memoryObject, memorySource], { env: this.env() });
    const objectPath = shortPath(memoryObject).replace(/\\/g, '/');
    const wraps = ['malloc', 'free', 'calloc', 'realloc'].map((name) => `--wrap=${name}`).join(' ');
    // --disable-dynamicbase: addr2line braucht feste Adressen, um die Zeile zu finden.
    await fs.promises.writeFile(this.memorySpecs, `*link:\n+ ${wraps} --disable-dynamicbase ${objectPath}\n\n`);
  }

  private async removeOldVersions(): Promise<void> {
    for (const name of await fs.promises.readdir(this.storage)) {
      const full = path.join(this.storage, name);
      if (name.startsWith('w64devkit-') && full !== this.root) {
        await fs.promises.rm(full, { recursive: true, force: true });
      }
    }
  }

  /** Löscht die Umgebung und richtet sie neu ein. Quelltexte liegen woanders und bleiben. */
  async reset(): Promise<void> {
    this.ready = undefined;
    await fs.promises.rm(this.storage, { recursive: true, force: true });
    await this.ensure();
  }

  /** Umgebung für alle Kindprozesse: das Kit steht vorn im PATH, nur für diesen Prozess. */
  env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    let oldPath = '';
    for (const [key, value] of Object.entries(process.env)) {
      // Unter Windows heißt die Variable oft „Path“; in einer Kopie zählt die Schreibweise.
      if (key.toUpperCase() === 'PATH') {
        oldPath = value ?? '';
      } else {
        env[key] = value;
      }
    }
    env.PATH = `${this.bin};${oldPath}`;
    delete env.GCC_COLORS;
    if (fs.existsSync(this.libs)) {
      const append = (name: string, dir: string) => {
        const old = env[name];
        env[name] = old ? `${old};${dir}` : dir;
      };
      append('CPATH', path.join(this.libs, 'include'));
      append('LIBRARY_PATH', path.join(this.libs, 'lib'));
      append('PKG_CONFIG_PATH', path.join(this.libs, 'lib', 'pkgconfig'));
    }
    return env;
  }
}

const shortPaths = new Map<string, string>();

/**
 * gdb versteht keine Umlaute im Pfad, Linker-Vorgaben und make keine Leerzeichen.
 * Liefert für solche Pfade den kurzen Windows-Namen (8.3); ohne kurzen Namen
 * bleibt der Pfad unverändert.
 */
export function shortPath(file: string): string {
  if (/^[\x21-\x7e]*$/.test(file)) {
    return file;
  }
  let short = shortPaths.get(file);
  if (!short) {
    const result = cp.spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${file}") do @echo %~sI"`], {
      encoding: 'utf8',
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    const line = (result.stdout ?? '').trim();
    short = result.status === 0 && /^[\x20-\x7e]+$/.test(line) ? line : file;
    shortPaths.set(file, short);
  }
  return short;
}

export interface RunResult {
  code: number;
  output: string;
}

/** Entschlüsselt Prozessausgaben: UTF-8, sonst Windows-1252 (make meldet Pfade so). */
export function decode(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Startet ein Werkzeug ohne Fenster und sammelt die Ausgabe. Wirft bei Fehlcode nur mit check. */
export function run(
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; check?: boolean; onData?: (text: string) => void } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(file, args, { cwd: options.cwd, env: options.env, windowsHide: true });
    const chunks: Buffer[] = [];
    const collect = (data: Buffer) => {
      chunks.push(data);
      options.onData?.(decode(data));
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => reject(explainSpawnError(file, error)));
    child.on('close', (code) => {
      const output = decode(Buffer.concat(chunks));
      if (code !== 0 && options.check !== false) {
        reject(new Error(`${path.basename(file)} endete mit Code ${code}: ${output}`));
      } else {
        resolve({ code: code ?? -1, output });
      }
    });
  });
}

function explainSpawnError(file: string, error: NodeJS.ErrnoException): Error {
  if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'UNKNOWN') {
    return new Error(
      `Windows lässt ${path.basename(file)} nicht starten. Vermutlich blockiert eine Richtlinie ` +
        '(AppLocker) oder ein Virenscanner Programme im Benutzerprofil. Bitte an die IT wenden.',
    );
  }
  return error;
}
