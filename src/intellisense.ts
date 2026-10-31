// Versorgt die C/C++-Extension mit Einstellungen, ohne Datei im Projekt: den
// Compiler aus dem Kit und bei Makefile-Projekten die Flags aus make2compdb.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  CppToolsApi,
  CustomConfigurationProvider,
  getCppToolsApi,
  SourceFileConfigurationItem,
  Version,
  WorkspaceBrowseConfiguration,
} from 'vscode-cpptools';
import { Kit, run } from './kit';
import { findMakeDir, hash, includeDirs, sourceRoot } from './project';

interface CompileEntry {
  directory: string;
  file: string;
  command?: string;
  arguments?: string[];
}

interface Flags {
  includePath: string[];
  defines: string[];
  standard?: string;
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  for (let match = pattern.exec(command); match; match = pattern.exec(command)) {
    tokens.push(match[1] ?? match[2]);
  }
  return tokens;
}

function parseFlags(entry: CompileEntry): Flags {
  const tokens = entry.arguments ?? tokenize(entry.command ?? '');
  const flags: Flags = { includePath: [], defines: [] };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '-I' || token === '-isystem') {
      flags.includePath.push(path.resolve(entry.directory, tokens[++i] ?? ''));
    } else if (token.startsWith('-I')) {
      flags.includePath.push(path.resolve(entry.directory, token.slice(2)));
    } else if (token === '-D') {
      flags.defines.push(tokens[++i] ?? '');
    } else if (token.startsWith('-D')) {
      flags.defines.push(token.slice(2));
    } else if (token.startsWith('-std=')) {
      flags.standard = token.slice(5);
    }
  }
  return flags;
}

export class IntelliSense implements CustomConfigurationProvider, vscode.Disposable {
  readonly name = 'HAW Kiel C';
  readonly extensionId = 'thomasrinder.haw-c';
  private api: CppToolsApi | undefined;

  constructor(private readonly kit: Kit) {}

  async register(): Promise<void> {
    this.api = await getCppToolsApi(Version.v5);
    if (this.api) {
      this.api.registerCustomConfigurationProvider(this);
      this.api.notifyReady(this);
    }
  }

  private dbFile(makeDir: string): string {
    return path.join(this.kit.compdbDir, hash(makeDir), 'compile_commands.json');
  }

  /** Zeichnet die Compiler-Aufrufe auf, ohne etwas zu bauen (make -n). */
  async refresh(makeDir: string): Promise<void> {
    const { output, code } = await run(this.kit.tool('make'), ['-Bwn'], {
      cwd: makeDir,
      env: this.kit.env(),
      check: false,
    });
    if (code !== 0) {
      return;
    }
    const file = this.dbFile(makeDir);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const json = await new Promise<string>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const child = require('child_process').spawn(this.kit.tool('make2compdb'), [], {
        cwd: makeDir,
        env: this.kit.env(),
        windowsHide: true,
      });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (data: Buffer) => chunks.push(data));
      child.on('error', reject);
      child.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
      child.stdin.end(output, 'utf8');
    });
    await fs.promises.writeFile(file, json, 'utf8');
    this.api?.didChangeCustomConfiguration(this);
  }

  private flagsFor(file: string): Flags {
    const dir = path.dirname(file);
    const root = sourceRoot(file);
    const fallback: Flags = {
      includePath: [dir, ...includeDirs(root).map((name) => path.resolve(root, name))],
      defines: [],
      standard: 'c17',
    };
    const makeDir = findMakeDir(file);
    if (!makeDir) {
      return fallback;
    }
    fallback.includePath.push(path.join(makeDir, 'include'), makeDir);
    let entries: CompileEntry[];
    try {
      entries = JSON.parse(fs.readFileSync(this.dbFile(makeDir), 'utf8'));
    } catch {
      return fallback;
    }
    const own = entries.find(
      (entry) => path.resolve(entry.directory, entry.file).toLowerCase() === file.toLowerCase(),
    );
    if (own) {
      const flags = parseFlags(own);
      flags.includePath.push(dir);
      return flags;
    }
    // Für Header gibt es keinen Aufruf: Vereinigung aller Include-Pfade.
    for (const entry of entries) {
      fallback.includePath.push(...parseFlags(entry).includePath);
    }
    return fallback;
  }

  async canProvideConfiguration(uri: vscode.Uri): Promise<boolean> {
    return /\.(c|h)$/i.test(uri.fsPath);
  }

  async provideConfigurations(uris: vscode.Uri[]): Promise<SourceFileConfigurationItem[]> {
    await this.kit.ensure();
    return uris.map((uri) => {
      const flags = this.flagsFor(uri.fsPath);
      return {
        uri,
        configuration: {
          includePath: [...new Set(flags.includePath)],
          defines: flags.defines,
          standard: (flags.standard as 'c17') ?? 'c17',
          intelliSenseMode: 'windows-gcc-x64',
          compilerPath: this.kit.tool('gcc'),
        },
      };
    });
  }

  async canProvideBrowseConfiguration(): Promise<boolean> {
    return true;
  }

  async provideBrowseConfiguration(): Promise<WorkspaceBrowseConfiguration | null> {
    await this.kit.ensure();
    return {
      browsePath: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
      compilerPath: this.kit.tool('gcc'),
      standard: 'c17',
    };
  }

  async canProvideBrowseConfigurationsPerFolder(): Promise<boolean> {
    return false;
  }

  async provideFolderBrowseConfiguration(): Promise<WorkspaceBrowseConfiguration | null> {
    return null;
  }

  dispose(): void {
    // Beim Beenden kann cpptools schon fort sein; das darf nicht weiter stören.
    try {
      this.api?.dispose();
    } catch {
      this.api = undefined;
    }
  }
}
