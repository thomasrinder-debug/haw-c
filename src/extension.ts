// Einstieg der Extension: Befehle Ausführen, Debuggen, Make-Ziele, Vorlagen.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { generalHints, parseOutput, publish } from './diagnostics';
import { IntelliSense } from './intellisense';
import { Kit, KIT_VERSION, run, shortPath } from './kit';
import { formatResults, readTask, runTests, TASK_FILE, TestResult } from './selftest';
import { writeSteps } from './steps';
import {
  currentProject,
  findExecutables,
  includeDirs,
  makeTargets,
  noProjectReason,
  outputFor,
  Project,
  splitArgs,
} from './project';

const GCC_FLAGS = ['-std=c17', '-Wall', '-Wextra', '-g', '-O0', '-fsanitize=undefined', '-fsanitize-trap'];
const CRASH_TEXT = new Map<number, string>([
  [0xc0000005, 'unerlaubter Speicherzugriff (ungültiger Zeiger)'],
  [0xc000001d, 'undefiniertes Verhalten: Nullzeiger, Feldgrenze, Überlauf oder Division durch null'],
  [0xc0000094, 'ganzzahlige Division durch null'],
  [0xc00000fd, 'Stacküberlauf, oft eine Rekursion ohne Abbruch'],
  [0xc0000374, 'Heap beschädigt'],
  [0xc0000409, 'Puffer auf dem Stack überschrieben'],
]);

let kit: Kit;
let intelliSense: IntelliSense;
let context: vscode.ExtensionContext;
let diagnostics: vscode.DiagnosticCollection;
let channel: vscode.OutputChannel;
let checkChannel: vscode.OutputChannel;
let status: vscode.StatusBarItem;
/** Für die Tests: Rückgabewert des letzten Programmlaufs. */
const api = {
  lastExitCode: undefined as number | undefined,
  kit: () => kit,
  setArgs: (line: string) => context.workspaceState.update(argsKey(requireProject()), line),
};

export function activate(extensionContext: vscode.ExtensionContext) {
  context = extensionContext;
  kit = new Kit(context);
  intelliSense = new IntelliSense(kit);
  diagnostics = vscode.languages.createDiagnosticCollection('haw-c');
  channel = vscode.window.createOutputChannel('HAW Kiel C');
  checkChannel = vscode.window.createOutputChannel('HAW Kiel C: Aufgabe');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'hawC.menu';

  const commands: [string, () => unknown][] = [
    ['hawC.run', runProgram],
    ['hawC.debug', debugProgram],
    ['hawC.build', () => buildCurrent()],
    ['hawC.check', checkTask],
    ['hawC.steps', showSteps],
    ['hawC.runMemory', runWithMemoryCheck],
    ['hawC.menu', showMenu],
    ['hawC.makeTarget', pickMakeTarget],
    ['hawC.setArgs', setArgs],
    ['hawC.toggleFolder', toggleFolder],
    ['hawC.newProject', newProject],
    ['hawC.terminal', openTerminal],
    ['hawC.diagnose', copyDiagnosis],
    ['hawC.reset', resetEnvironment],
  ];
  for (const [name, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(name, () => guarded(handler)));
  }
  // Das Menü „Run“ gehört VS Code und fragt nach einer Debug-Konfiguration. Sie
  // leitet nur auf unsere Befehle um; undefined beendet den Start ohne Meldung.
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('hawc', {
      resolveDebugConfiguration(_folder, config) {
        void guarded(config.noDebug ? runProgram : debugProgram);
        return undefined;
      },
    }),
  );
  context.subscriptions.push(
    diagnostics,
    channel,
    checkChannel,
    status,
    intelliSense,
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.workspace.onDidChangeConfiguration(updateStatus),
  );
  updateStatus();

  // Einrichtung und Editorhilfe im Hintergrund, damit der erste Klick nicht warten muss.
  // Das Kit wird erst entpackt, wenn C gebraucht wird, nicht bei jedem Start von VS Code.
  const prepare = () =>
    guarded(async () => {
      await kit.ensure();
      await intelliSense.register();
      const project = currentProject();
      if (project?.kind === 'make') {
        await intelliSense.refresh(project.dir);
      }
    });
  const isCDocument = (document: vscode.TextDocument) =>
    document.languageId === 'c' || document.languageId === 'makefile';
  void guarded(ensureLaunchConfig);
  if (vscode.workspace.textDocuments.some(isCDocument)) {
    void prepare();
  } else {
    const listener = vscode.workspace.onDidOpenTextDocument((document) => {
      if (isCDocument(document)) {
        listener.dispose();
        void prepare();
      }
    });
    context.subscriptions.push(listener);
  }
  return api;
}

export function deactivate() {}

/**
 * Trägt „HAW Kiel C“ in die Benutzereinstellung launch ein, damit das Menü „Run“ ohne
 * launch.json funktioniert. VS Code erlaubt dafür keine Voreinstellung im Paket.
 * Vorhandene Einträge bleiben erhalten.
 */
async function ensureLaunchConfig(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const user = config.inspect<{ configurations?: { type?: string; name?: string }[] }>('launch')?.globalValue;
  const entries = user?.configurations ?? [];
  const own = { type: 'hawc', request: 'launch', name: 'HAW Kiel C' };
  if (entries.some((entry) => entry.type === own.type && entry.name === own.name)) {
    return;
  }
  // Ein Eintrag unter dem früheren Namen wird ersetzt.
  const others = entries.filter((entry) => entry.type !== own.type);
  await config.update(
    'launch',
    { version: '0.2.0', ...user, configurations: [...others, own] },
    vscode.ConfigurationTarget.Global,
  );
}

async function guarded(action: () => unknown): Promise<unknown> {
  try {
    return await action();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    channel.appendLine(text);
    void vscode.window.showErrorMessage(`HAW Kiel C: ${text}`);
    return undefined;
  }
}

function updateStatus(): void {
  const project = currentProject();
  const hasTask = !!project && fs.existsSync(path.join(project.dir, TASK_FILE));
  void vscode.commands.executeCommand('setContext', 'hawC.hatAufgabe', hasTask);
  if (!project) {
    status.hide();
    return;
  }
  const label =
    project.kind === 'make'
      ? 'Makefile'
      : project.kind === 'folder'
        ? `${project.sources.length} Dateien`
        : 'Einzeldatei';
  status.text = `$(tools) HAW Kiel C: ${label}`;
  status.tooltip = 'HAW Kiel C: Menü öffnen';
  status.show();
}

function requireProject(): Project {
  const project = currentProject();
  if (!project) {
    throw new Error(noProjectReason(vscode.window.activeTextEditor?.document.uri.fsPath));
  }
  return project;
}

// ---- Bauen ----

/** Baut das Projekt; true bei Erfolg. Fehler landen im Problemfenster und im Ausgabefenster. */
async function build(project: Project, makeWithMemoryCheck = false): Promise<boolean> {
  await kit.ensure();
  await vscode.workspace.saveAll(false);
  await stopRunning();
  channel.clear();

  let file: string;
  let args: string[];
  if (project.kind === 'make') {
    file = kit.tool('make');
    // Das Makefile bestimmt die Flags. Die Speicherprüfung gibt es dort nur auf Wunsch.
    const specs = shortPath(kit.memorySpecs).replace(/\\/g, '/');
    args = makeWithMemoryCheck ? ['-w', '-B', `CC=gcc -specs=${specs}`] : ['-w'];
  } else {
    const output = outputFor(kit, project);
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    file = kit.tool('gcc');
    args = [
      ...GCC_FLAGS,
      ...(memoryCheckEnabled(project) ? [`-specs=${kit.memorySpecs}`] : []),
      ...includeDirs(project.dir).map((name) => `-I${name}`),
      ...project.sources.map((source) => path.relative(project.dir, source)),
      '-o',
      output,
      '-lm',
    ];
  }
  // Aus dem kurzen Pfad gebaut, stehen in den Debug-Informationen keine Umlaute.
  const buildDir = shortPath(project.dir);
  const result = await run(file, args, { cwd: buildDir, env: kit.env(), check: false });
  const code = result.code;
  const output = result.output
    .split(buildDir).join(project.dir)
    .split(buildDir.replace(/\\/g, '/')).join(project.dir.replace(/\\/g, '/'));
  channel.appendLine(`> ${path.basename(file, '.exe')} ${args.join(' ')}`);
  channel.append(output);
  publish(diagnostics, parseOutput(output, project.dir));
  for (const hint of generalHints(output)) {
    channel.appendLine(`\nHinweis: ${hint}`);
    void vscode.window.showWarningMessage(hint);
  }
  if (code !== 0) {
    void vscode.commands.executeCommand('workbench.actions.view.problems');
    const parsed = parseOutput(output, project.dir).some(
      (finding) => finding.severity === vscode.DiagnosticSeverity.Error,
    );
    if (!parsed) {
      channel.show(true);
    }
    void vscode.window.setStatusBarMessage('$(error) Übersetzen fehlgeschlagen', 5000);
    return false;
  }
  if (project.kind === 'make') {
    void guarded(() => intelliSense.refresh(project.dir));
  }
  return true;
}

async function buildCurrent(): Promise<boolean> {
  await vscode.workspace.saveAll(false);
  return build(requireProject());
}

function memoryCheckEnabled(project: Project): boolean {
  const uri = vscode.Uri.file(project.dir);
  return (
    project.kind !== 'make' &&
    kit.memoryAvailable &&
    vscode.workspace.getConfiguration('hawC', uri).get<boolean>('speicherpruefung', true)
  );
}

/** Umgebung für einen Programmlauf; die Speicherprüfung schreibt ihren Bericht in die Datei. */
function programEnv(): Record<string, string> {
  fs.rmSync(kit.memoryReport, { force: true });
  return { ...kit.env(), HAW_SPEICHER_BERICHT: kit.memoryReport } as Record<string, string>;
}

/** Überträgt den Bericht der Speicherprüfung ins Problemfenster. Gibt die Meldungen zurück. */
function applyMemoryReport(project: Project): string[] {
  if (!fs.existsSync(kit.memoryReport)) {
    return [];
  }
  const shortDir = path.normalize(shortPath(project.dir)).toLowerCase();
  const messages: string[] = [];
  for (const line of fs.readFileSync(kit.memoryReport, 'utf8').split(/\r?\n/)) {
    const match = /^(.+):(\d+)\|(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    let file = path.normalize(match[1]);
    if (file.toLowerCase().startsWith(shortDir)) {
      file = project.dir + file.slice(shortDir.length);
    }
    const uri = vscode.Uri.file(file);
    const row = Math.max(Number(match[2]) - 1, 0);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(row, 0, row, 200),
      match[3],
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'Speicherprüfung';
    diagnostics.set(uri, [...(diagnostics.get(uri) ?? []), diagnostic]);
    messages.push(`${path.basename(file)}:${match[2]}: ${match[3]}`);
  }
  return messages;
}

function argsKey(project: Project): string {
  return `args:${project.dir.toLowerCase()}`;
}

function programArgs(project: Project): string[] {
  return splitArgs(context.workspaceState.get<string>(argsKey(project), ''));
}

/** Bestimmt das zu startende Programm. Mehrere im Makefile-Projekt: Auswahl, die gespeichert wird. */
async function resolveExecutable(project: Project): Promise<string | undefined> {
  if (project.kind !== 'make') {
    return outputFor(kit, project);
  }
  const candidates = findExecutables(project.dir);
  if (candidates.length === 0) {
    throw new Error('Das Makefile hat kein Programm (.exe) erzeugt.');
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const key = `exe:${project.dir.toLowerCase()}`;
  const saved = context.workspaceState.get<string>(key);
  if (saved && candidates.includes(saved)) {
    return saved;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((file) => path.relative(project.dir, file)),
    { placeHolder: 'Welches Programm soll starten?' },
  );
  if (!picked) {
    return undefined;
  }
  const chosen = path.join(project.dir, picked);
  await context.workspaceState.update(key, chosen);
  return chosen;
}

// ---- Starten ----

const TASK_LABEL = 'Programm';

async function stopRunning(): Promise<void> {
  const running = vscode.tasks.taskExecutions.filter((item) => item.task.definition.type === 'hawc');
  await Promise.all(
    running.map(
      (execution) =>
        new Promise<void>((resolve) => {
          const listener = vscode.tasks.onDidEndTask((event) => {
            if (event.execution === execution) {
              listener.dispose();
              resolve();
            }
          });
          execution.terminate();
          setTimeout(() => {
            listener.dispose();
            resolve();
          }, 2000);
        }),
    ),
  );
}

async function startInTerminal(
  project: Project,
  file: string,
  args: string[],
  retry?: () => unknown,
): Promise<void> {
  const execution = new vscode.ProcessExecution(kit.starter, [file, ...args], {
    cwd: project.dir,
    env: programEnv(),
  });
  const task = new vscode.Task(
    { type: 'hawc', label: TASK_LABEL },
    vscode.TaskScope.Workspace,
    TASK_LABEL,
    'HAW Kiel C',
    execution,
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    focus: true,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
    echo: false,
    showReuseMessage: false,
  };
  const started = await vscode.tasks.executeTask(task);
  const listener = vscode.tasks.onDidEndTaskProcess((event) => {
    if (event.execution !== started) {
      return;
    }
    listener.dispose();
    const code = (event.exitCode ?? 0) >>> 0;
    applyMemoryReport(project);
    api.lastExitCode = code;
    if (CRASH_TEXT.has(code) && retry) {
      void vscode.window
        .showErrorMessage('Das Programm ist abgestürzt.', 'Im Debugger wiederholen')
        .then((answer) => {
          if (answer) {
            void guarded(retry);
          }
        });
    }
  });
}

async function runProgram(): Promise<void> {
  // Erst speichern: Die Erkennung von main liest die Dateien von der Platte.
  await vscode.workspace.saveAll(false);
  const project = requireProject();
  if (project.kind === 'make' && (await makeTargets(kit, project.dir)).includes('run')) {
    // Das Ziel run baut selbst; zuerst bauen zeigt Fehler aber im Problemfenster.
    if (!(await build(project))) {
      return;
    }
    await startInTerminal(project, kit.tool('make'), ['-s', 'run']);
    return;
  }
  if (!(await build(project))) {
    return;
  }
  const file = await resolveExecutable(project);
  if (file) {
    await startInTerminal(project, file, programArgs(project), debugProgram);
  }
}

/** Makefile-Projekt einmal neu bauen und mit Speicherprüfung starten. */
async function runWithMemoryCheck(): Promise<void> {
  await vscode.workspace.saveAll(false);
  const project = requireProject();
  await kit.ensure();
  if (!kit.memoryAvailable) {
    throw new Error('Die Speicherprüfung braucht kurze Windows-Pfadnamen, die hier abgeschaltet sind.');
  }
  if (!(await build(project, true))) {
    return;
  }
  const file = await resolveExecutable(project);
  if (file) {
    await startInTerminal(project, file, programArgs(project), debugProgram);
  }
}

// ---- Aufgaben und Übersetzungsschritte ----

/** Baut das Programm und prüft es gegen die Tests aus aufgabe.json. */
async function checkTask(): Promise<TestResult[] | undefined> {
  await vscode.workspace.saveAll(false);
  const project = requireProject();
  const task = readTask(project.dir);
  if (!task) {
    throw new Error(`Hier gibt es keine ${TASK_FILE}.`);
  }
  if (!(await build(project))) {
    return undefined;
  }
  const file = await resolveExecutable(project);
  if (!file) {
    return undefined;
  }
  const results = await runTests(file, task, project.dir, programEnv(), (code) => CRASH_TEXT.get(code));
  const memory = applyMemoryReport(project);
  const passed = results.filter((result) => result.passed).length;
  checkChannel.clear();
  checkChannel.appendLine(formatResults(task, results));
  if (memory.length > 0) {
    checkChannel.appendLine('\nSpeicherprüfung:');
    memory.forEach((line) => checkChannel.appendLine(`    ${line}`));
  }
  checkChannel.show(true);
  const text = `${passed} von ${results.length} Tests bestanden.`;
  if (passed === results.length) {
    void vscode.window.showInformationMessage(text);
  } else {
    void vscode.window.showWarningMessage(text);
  }
  return results;
}

async function showSteps(): Promise<string> {
  await vscode.workspace.saveAll(false);
  const project = requireProject();
  await kit.ensure();
  const overview = await writeSteps(kit, project);
  await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(overview));
  return overview;
}

// ---- Debuggen ----

async function hasDebugInfo(file: string): Promise<boolean> {
  const { output } = await run(kit.tool('objdump'), ['-h', file], { env: kit.env(), check: false });
  return /\.debug_info/.test(output);
}

async function debugProgram(): Promise<void> {
  await vscode.workspace.saveAll(false);
  const project = requireProject();
  if (!(await build(project))) {
    return;
  }
  const file = await resolveExecutable(project);
  if (!file) {
    return;
  }
  if (!(await hasDebugInfo(file))) {
    void vscode.window.showWarningMessage(
      'Dem Programm fehlen Debug-Informationen: Im Makefile bei CFLAGS -g ergänzen, dann neu bauen (make clean).',
    );
  }
  const env = programEnv();
  const ended = vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.name === 'HAW Kiel C') {
      ended.dispose();
      applyMemoryReport(project);
    }
  });
  const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
    type: 'cppdbg',
    name: 'HAW Kiel C',
    request: 'launch',
    program: shortPath(file),
    args: programArgs(project),
    cwd: shortPath(project.dir),
    sourceFileMap: { [shortPath(project.dir)]: project.dir },
    MIMode: 'gdb',
    miDebuggerPath: kit.tool('gdb'),
    externalConsole: true,
    stopAtEntry: false,
    environment: [
      { name: 'PATH', value: env.PATH },
      { name: 'HAW_SPEICHER_BERICHT', value: env.HAW_SPEICHER_BERICHT },
    ],
    logging: { moduleLoad: false, programOutput: true },
  });
  if (!started) {
    ended.dispose();
    throw new Error('Der Debugger ließ sich nicht starten.');
  }
}

// ---- Menü und Werkzeuge ----

async function showMenu(): Promise<void> {
  const project = currentProject();
  const items: { label: string; command: string }[] = [];
  if (project?.kind === 'make') {
    items.push(
      { label: '$(list-unordered) Make-Ziel ausführen …', command: 'hawC.makeTarget' },
      { label: '$(shield) Mit Speicherprüfung neu bauen und starten', command: 'hawC.runMemory' },
    );
  } else if (project) {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const on = vscode.workspace.getConfiguration('hawC', uri).get<boolean>('nurAktiveDatei', false);
    items.push({
      label: `$(files) Nur aktive Datei übersetzen: ${on ? 'an' : 'aus'}`,
      command: 'hawC.toggleFolder',
    });
  }
  if (project) {
    if (fs.existsSync(path.join(project.dir, TASK_FILE))) {
      items.unshift({ label: '$(beaker) Aufgabe prüfen', command: 'hawC.check' });
    }
    items.push(
      { label: '$(symbol-parameter) Programmargumente …', command: 'hawC.setArgs' },
      { label: '$(list-ordered) Übersetzungsschritte anzeigen', command: 'hawC.steps' },
    );
  }
  items.push(
    { label: '$(new-folder) Neues Projekt …', command: 'hawC.newProject' },
    { label: '$(terminal) Terminal öffnen', command: 'hawC.terminal' },
    { label: '$(clippy) Diagnose kopieren', command: 'hawC.diagnose' },
    { label: '$(refresh) Umgebung neu aufsetzen', command: 'hawC.reset' },
  );
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'HAW Kiel C' });
  if (picked) {
    await vscode.commands.executeCommand(picked.command);
  }
}

async function pickMakeTarget(): Promise<void> {
  const project = requireProject();
  if (project.kind !== 'make') {
    throw new Error('Hier gibt es kein Makefile.');
  }
  await kit.ensure();
  const target = await vscode.window.showQuickPick(await makeTargets(kit, project.dir), {
    placeHolder: 'Make-Ziel ausführen',
  });
  if (!target) {
    return;
  }
  await vscode.workspace.saveAll(false);
  await stopRunning();
  await startInTerminal(project, kit.tool('make'), ['-s', target]);
}

async function setArgs(): Promise<void> {
  const project = requireProject();
  const value = await vscode.window.showInputBox({
    prompt: 'Argumente für das Programm, z. B. eingabe.txt 5',
    value: context.workspaceState.get<string>(argsKey(project), ''),
  });
  if (value !== undefined) {
    await context.workspaceState.update(argsKey(project), value);
  }
}

async function toggleFolder(): Promise<void> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const config = vscode.workspace.getConfiguration('hawC', uri);
  const target = vscode.workspace.workspaceFolders
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update('nurAktiveDatei', !config.get<boolean>('nurAktiveDatei', false), target);
}

async function openTerminal(): Promise<void> {
  await kit.ensure();
  const terminal = vscode.window.createTerminal({
    name: 'HAW Kiel C',
    shellPath: kit.tool('sh'),
    cwd: currentProject()?.dir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    env: kit.env() as Record<string, string>,
  });
  terminal.show();
}

async function resetEnvironment(): Promise<void> {
  const answer = await vscode.window.showWarningMessage(
    'Die Umgebung wird gelöscht und neu eingerichtet. Ihre Quelltexte bleiben erhalten.',
    { modal: true },
    'Neu aufsetzen',
  );
  if (answer) {
    await stopRunning();
    await kit.reset();
    void vscode.window.showInformationMessage('HAW Kiel C ist neu eingerichtet.');
  }
}

async function diagnosisText(): Promise<string> {
  const lines = [
    `HAW Kiel C ${context.extension.packageJSON.version}, Kit ${KIT_VERSION}`,
    `VS Code ${vscode.version}, Windows ${process.env.OS ?? ''} ${require('os').release()}`,
    `Speicher: ${kit.storage}`,
    `Kit vorhanden: ${fs.existsSync(kit.tool('gcc'))}, Starter vorhanden: ${fs.existsSync(kit.starter)}`,
    `Projekt: ${JSON.stringify(currentProject() ?? null)}`,
  ];
  try {
    await kit.ensure();
    const version = await run(kit.tool('gcc'), ['--version'], { env: kit.env() });
    lines.push(version.output.split(/\r?\n/)[0]);
    const temp = path.join(kit.storage, 'diagnose');
    await fs.promises.mkdir(temp, { recursive: true });
    const source = path.join(temp, 'test.c');
    const program = path.join(temp, 'test.exe');
    await fs.promises.writeFile(source, '#include <stdio.h>\nint main(void){puts("ok");return 0;}\n');
    await run(kit.tool('gcc'), [source, '-o', program], { env: kit.env() });
    const result = await run(program, [], { env: kit.env() });
    lines.push(`Testprogramm: ${result.output.trim()}`);
  } catch (error) {
    lines.push(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Der Benutzername gehört nicht in einen Bericht.
  const user = process.env.USERNAME;
  const text = lines.join('\n');
  return user ? text.split(user).join('<Benutzer>') : text;
}

async function copyDiagnosis(): Promise<void> {
  await vscode.env.clipboard.writeText(await diagnosisText());
  void vscode.window.showInformationMessage('Die Diagnose ist in der Zwischenablage.');
}

// ---- Vorlagen ----

const TEMPLATES = [
  { label: 'Einzeldatei', folder: 'einzeldatei', open: 'main.c' },
  { label: 'Aufgabe mit Selbsttest', folder: 'aufgabe', open: 'main.c' },
  { label: 'Makefile-Projekt', folder: 'makefile', open: 'src/main.c' },
  { label: 'Mit eigener Bibliothek', folder: 'bibliothek', open: 'src/main.c' },
];

async function newProject(): Promise<void> {
  const template = await vscode.window.showQuickPick(TEMPLATES, { placeHolder: 'Art des Projekts' });
  if (!template) {
    return;
  }
  const parent = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: 'Hier anlegen',
  });
  if (!parent) {
    return;
  }
  const name = await vscode.window.showInputBox({
    prompt: 'Name des Projektordners (ohne Umlaute)',
    validateInput: (value) => (/^[A-Za-z0-9_\- ]+$/.test(value) ? undefined : 'Nur Buchstaben, Ziffern, _ und -'),
  });
  if (!name) {
    return;
  }
  const target = path.join(parent[0].fsPath, name);
  if (fs.existsSync(target)) {
    throw new Error(`Den Ordner ${target} gibt es schon.`);
  }
  await fs.promises.cp(path.join(context.extensionPath, 'vorlagen', template.folder), target, {
    recursive: true,
  });
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), {
    forceNewWindow: !!vscode.workspace.workspaceFolders,
  });
}
