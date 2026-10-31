// Prüft die Extension im echten VS Code: Bauen, Starten, Eingabe im Terminal,
// Abstürze, Makefile, Editorhilfe, Debugger samt Eingabe im Konsolenfenster.
import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface Api {
  lastExitCode: number | undefined;
  setArgs(line: string): Thenable<void>;
  kit(): { ensure(): Promise<void>; root: string; tool(name: string): string; env(): NodeJS.ProcessEnv; storage: string; compdbDir: string };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(what: string, probe: () => T | undefined | false, ms = 60000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) {
      return value;
    }
    if (Date.now() > end) {
      throw new Error(`Zeitüberschreitung: ${what}`);
    }
    await sleep(200);
  }
}

export async function run(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const extension = vscode.extensions.getExtension<Api>('thomasrinder.haw-c')!;
  await sleep(5000);
  const activeWithoutC = extension.isActive;
  const api = await extension.activate();
  const kit = api.kit();

  const write = (name: string, text: string) => {
    const file = path.join(workspace, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return file;
  };
  const open = async (file: string) => {
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document);
    return document;
  };
  /** Startet und wartet auf das Ende, liefert den Rückgabewert. */
  const runAndWait = async (file: string, whileRunning?: () => Promise<void>) => {
    await open(file);
    api.lastExitCode = undefined;
    await vscode.commands.executeCommand('hawC.run');
    await whileRunning?.();
    await waitFor('Programmende', () => api.lastExitCode !== undefined);
    return api.lastExitCode as unknown as number;
  };
  const errorsIn = (file: string) =>
    vscode.languages
      .getDiagnostics(vscode.Uri.file(file))
      .filter((item) => item.source === 'gcc' && item.severity === vscode.DiagnosticSeverity.Error);

  const results: string[] = [];
  const failures: string[] = [];
  const test = async (name: string, body: () => Promise<void>) => {
    const start = Date.now();
    try {
      await body();
      results.push(`ok    ${name} (${Date.now() - start} ms)`);
    } catch (error) {
      failures.push(name);
      results.push(`FEHLER ${name}: ${error instanceof Error ? error.stack : error}`);
    }
    console.log(results[results.length - 1]);
  };

  await test('Ohne C-Datei bleibt die Extension inaktiv', async () => {
    assert.strictEqual(activeWithoutC, false);
  });

  await test('Einrichtung entpackt das Kit', async () => {
    await kit.ensure();
    assert.ok(fs.existsSync(kit.tool('gcc')));
    assert.ok(!fs.existsSync(path.join(kit.root, 'lib32')));
    console.log(`Speicher: ${kit.storage}`);
  });

  await test('Programm läuft, Rückgabewert kommt an, Projektordner bleibt sauber', async () => {
    const file = write('einzel/hallo.c', '#include <stdio.h>\nint main(void){printf("Größe\\n");return 3;}\n');
    assert.strictEqual(await runAndWait(file), 3);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['hallo.c']);
  });

  await test('Argumente mit Leerzeichen und relative Dateien im Projektordner', async () => {
    const file = write(
      'einzel/args.c',
      '#include <stdio.h>\nint main(int c,char**v){FILE*f=fopen("args.txt","w");if(!f)return 9;fprintf(f,"%d|%s",c,c>1?v[1]:"");fclose(f);return 0;}\n',
    );
    await open(file);
    const context = (await vscode.commands.executeCommand('hawC.build')) as boolean;
    assert.strictEqual(context, true);
    await api.setArgs('"zwei Wörter" 5');
    assert.strictEqual(await runAndWait(file), 0);
    const text = fs.readFileSync(path.join(workspace, 'einzel/args.txt'));
    console.log(`Argument gelesen: ${text.toString('hex')}`);
    assert.ok(text.toString('latin1').startsWith('3|zwei '), text.toString('latin1'));
    await api.setArgs('');
  });

  await test('Compilerfehler erscheinen mit deutschem Hinweis', async () => {
    const file = write('fehler/fehler.c', '#include <stdio.h>\nint main(void){\n  int x = 1\n  return x;\n}\n');
    await open(file);
    const ok = await vscode.commands.executeCommand('hawC.build');
    assert.strictEqual(ok, false);
    const errors = errorsIn(file);
    assert.ok(errors.length > 0, 'keine Fehler im Problemfenster');
    assert.ok(/Semikolon/.test(errors[0].message), errors[0].message);
  });

  await test('Nullzeiger meldet den Absturzcode', async () => {
    const file = write('absturz/nullz.c', '#include <stdio.h>\nint main(void){int*p=NULL;*p=1;return 0;}\n');
    assert.strictEqual(await runAndWait(file), 0xc000001d);
  });

  await test('scanf im Terminal, auch mit Umlauten', async () => {
    const file = write(
      'eingabe/ein.c',
      '#include <stdio.h>\nint main(void){int n;char s[64]={0};printf("Zahl: ");fflush(stdout);\n' +
        'if(scanf("%d %63s",&n,s)!=2)return 8;FILE*f=fopen("ein.txt","wb");fprintf(f,"%d|",n);\n' +
        'for(char*c=s;*c;c++)fprintf(f,"%02x",(unsigned char)*c);fclose(f);return 0;}\n',
    );
    const code = await runAndWait(file, async () => {
      const terminal = await waitFor('Terminal', () =>
        vscode.window.terminals.find((item) => item.name.includes('Programm')),
      );
      await sleep(1500);
      terminal.sendText('42 Grüß', true);
    });
    assert.strictEqual(code, 0);
    const text = fs.readFileSync(path.join(workspace, 'eingabe/ein.txt'), 'utf8');
    console.log(`scanf gelesen: ${text} (UTF-8 von Grüß wäre 4772c3bcc39f)`);
    assert.ok(text.startsWith('42|47'), text);
  });

  await test('Mehrere .c-Dateien und eigener Header ohne Makefile', async () => {
    const main = write('mehr/main.c', '#include "plus.h"\nint main(void){return plus(2,3);}\n');
    const other = write('mehr/plus.c', '#include "plus.h"\nint plus(int a,int b){return a+b;}\n');
    const header = write('mehr/plus.h', '#ifndef PLUS_H\n#define PLUS_H\nint plus(int a,int b);\n#endif\n');
    assert.strictEqual(await runAndWait(main), 5);
    assert.strictEqual(await runAndWait(other), 5, 'Start aus der Datei ohne main');
    assert.strictEqual(await runAndWait(header), 5, 'Start aus dem Header');
    await open(main);
    await vscode.commands.executeCommand('hawC.toggleFolder');
    assert.strictEqual(await vscode.commands.executeCommand('hawC.build'), false, 'nur aktive Datei');
    await vscode.commands.executeCommand('hawC.toggleFolder');
  });

  await test('Aufteilung in src und include ohne Makefile, Fehler im Header', async () => {
    const main = write('teile/src/main.c', '#include "plus.h"\nint main(void){return plus(1,1);}\n');
    write('teile/src/plus.c', '#include "plus.h"\nint plus(int a,int b){return a+b;}\n');
    const header = write('teile/include/plus.h', 'int plus(int a int b);\n');
    await open(main);
    assert.strictEqual(await vscode.commands.executeCommand('hawC.build'), false);
    assert.ok(errorsIn(header).length > 0, 'Fehler im Header fehlt im Problemfenster');
    fs.writeFileSync(header, 'int plus(int a,int b);\n');
    assert.strictEqual(await runAndWait(main), 2);
    assert.deepStrictEqual(fs.readdirSync(path.join(workspace, 'teile')).sort(), ['include', 'src']);
  });

  await test('Mehrere Programme mit main und gemeinsame Hilfsdatei', async () => {
    const one = write('aufg/a1.c', 'int hilfe(void);\nint main(void){return hilfe()+1;}\n');
    const two = write('aufg/a2.c', 'int hilfe(void);\nint main(void){return hilfe()+2;}\n');
    const helper = write('aufg/hilfe.c', 'int hilfe(void){return 10;}\n');
    assert.strictEqual(await runAndWait(one), 11);
    assert.strictEqual(await runAndWait(two), 12);
    await open(helper);
    assert.notStrictEqual(await vscode.commands.executeCommand('hawC.build'), true, 'welches Programm ist unklar');
  });

  const templates = path.join(extension.extensionPath, 'vorlagen');
  await test('Vorlage Makefile: Ziel run, Fehler aus Unterordner, Editorhilfe', async () => {
    const dir = path.join(workspace, 'mk');
    fs.cpSync(path.join(templates, 'makefile'), dir, { recursive: true });
    const main = path.join(dir, 'src', 'main.c');
    assert.strictEqual(await runAndWait(main), 0);
    assert.ok(fs.existsSync(path.join(dir, 'build', 'programm.exe')));

    const compdb = await waitFor('compile_commands', () => {
      const found = fs.existsSync(kit.compdbDir) && fs.readdirSync(kit.compdbDir);
      return found && found.length > 0 ? path.join(kit.compdbDir, found[0], 'compile_commands.json') : undefined;
    });
    await sleep(500);
    const entries = JSON.parse(fs.readFileSync(compdb, 'utf8'));
    assert.ok(entries.length >= 2, JSON.stringify(entries));

    const broken = path.join(dir, 'src', 'rechnen.c');
    const original = fs.readFileSync(broken, 'utf8');
    fs.writeFileSync(broken, original.replace('return a + b;', 'return a + b'));
    await open(main);
    assert.strictEqual(await vscode.commands.executeCommand('hawC.build'), false);
    assert.ok(errorsIn(broken).length > 0, 'Fehler in src/rechnen.c fehlt im Problemfenster');
    fs.writeFileSync(broken, original);
  });

  await test('Vorlage Bibliothek: statisch und DLL, Pfad mit Umlaut', async () => {
    const dir = path.join(workspace, 'bib');
    fs.cpSync(path.join(templates, 'bibliothek'), dir, { recursive: true });
    const options = { cwd: dir, env: kit.env(), encoding: 'utf8' as const };
    const make = (...args: string[]) => cp.spawnSync(kit.tool('make'), args, options);
    assert.strictEqual(make('run').status, 0);
    const dll = make('run-dll');
    assert.strictEqual(dll.status, 0, dll.stdout + dll.stderr);
    assert.ok(/5/.test(dll.stdout));
  });

  await test('Editorhilfe findet stdio.h aus dem Kit', async () => {
    const file = write('hilfe/x.c', '#include <stdio.h>\nint main(void){printf("x");return 0;}\n');
    await open(file);
    const position = new vscode.Position(1, 18);
    const target = await waitFor(
      'Sprung zu printf',
      () => {
        void vscode.commands
          .executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', vscode.Uri.file(file), position)
          .then((list) => (lastDefinition = list?.[0]));
        return lastDefinition;
      },
      120000,
    );
    const uri = 'uri' in target ? target.uri : target.targetUri;
    console.log(`printf: ${uri.fsPath}`);
    assert.ok(uri.fsPath.includes('w64devkit'), uri.fsPath);
  });

  await test('Debugger hält bei Absturz an der richtigen Zeile', async () => {
    const file = write('debug/crash.c', '#include <stdio.h>\nint main(void){\n  int *p = NULL;\n  *p = 1;\n  return 0;\n}\n');
    await open(file);
    const stopped = watchDebugger();
    await vscode.commands.executeCommand('hawC.debug');
    const session = await waitFor('Debug-Sitzung', () => vscode.debug.activeDebugSession, 60000);
    await waitFor('Halt im Debugger', () => stopped.events.length > 0, 60000);
    const threadId = stopped.events[0].body.threadId;
    const stack = await session.customRequest('stackTrace', { threadId });
    console.log(`gehalten: ${stopped.events[0].body.reason}, Zeile ${stack.stackFrames[0].line}`);
    assert.strictEqual(stack.stackFrames[0].line, 4);
    await vscode.debug.stopDebugging(session);
    await waitFor('Debug-Ende', () => !vscode.debug.activeDebugSession);
    stopped.dispose();
  });

  await test('Debugger: Haltepunkt und scanf im Konsolenfenster', async () => {
    // Das Hilfsprogramm schreibt die Eingabe in die Konsole des Testprogramms.
    const helperSource = write(
      'debug/tippen.c',
      '#include <windows.h>\nint main(int c,char**v){DWORD pid=atoi(v[1]);FreeConsole();if(!AttachConsole(pid))return 1;\n' +
        'HANDLE in=CreateFileA("CONIN$",GENERIC_READ|GENERIC_WRITE,3,0,OPEN_EXISTING,0,0);const char*t="42\\r";\n' +
        'for(const char*p=t;*p;p++){INPUT_RECORD r[2]={0};r[0].EventType=KEY_EVENT;r[0].Event.KeyEvent.bKeyDown=1;r[0].Event.KeyEvent.wRepeatCount=1;\n' +
        'r[0].Event.KeyEvent.uChar.AsciiChar=*p;r[1]=r[0];r[1].Event.KeyEvent.bKeyDown=0;DWORD n;WriteConsoleInputA(in,r,2,&n);}return 0;}\n',
    );
    const helper = path.join(path.dirname(helperSource), 'tippen.exe');
    const built = cp.spawnSync(kit.tool('gcc'), ['-include', 'stdlib.h', helperSource, '-o', helper], { env: kit.env(), encoding: 'utf8' });
    assert.strictEqual(built.status, 0, built.stderr);
    fs.unlinkSync(helperSource);

    const file = write(
      'debug2/ein.c',
      '#include <stdio.h>\n#include <windows.h>\nint main(void){\n  FILE *f = fopen("pid.txt", "w");\n  fprintf(f, "%lu", GetCurrentProcessId());\n  fclose(f);\n' +
        '  int n = 0;\n  scanf("%d", &n);\n  f = fopen("ergebnis.txt", "w");\n  fprintf(f, "%d", n);\n  fclose(f);\n  return 0;\n}\n',
    );
    await open(file);
    const uri = vscode.Uri.file(file);
    vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(8, 0)))]);
    const stopped = watchDebugger();
    await vscode.commands.executeCommand('hawC.debug');
    const session = await waitFor('Debug-Sitzung', () => vscode.debug.activeDebugSession, 60000);
    const pidFile = path.join(path.dirname(file), 'pid.txt');
    await waitFor('pid.txt', () => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').length > 0);
    await sleep(1000);
    const typed = cp.spawnSync(helper, [fs.readFileSync(pidFile, 'utf8')], { encoding: 'utf8' });
    assert.strictEqual(typed.status, 0, `Eingabe in die Konsole fehlgeschlagen: ${typed.status}`);
    await waitFor('Haltepunkt nach scanf', () => stopped.events.length > 0, 30000);
    const stack = await session.customRequest('stackTrace', { threadId: stopped.events[0].body.threadId });
    assert.strictEqual(stack.stackFrames[0].line, 9);
    await session.customRequest('continue', { threadId: stopped.events[0].body.threadId });
    await waitFor('Debug-Ende', () => !vscode.debug.activeDebugSession, 30000);
    assert.strictEqual(fs.readFileSync(path.join(path.dirname(file), 'ergebnis.txt'), 'utf8'), '42');
    stopped.dispose();
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  });

  const memoryDiagnostics = (file: string) =>
    vscode.languages.getDiagnostics(vscode.Uri.file(file)).filter((item) => item.source === 'Speicherprüfung');

  await test('Speicherprüfung findet Fehler mit Zeile', async () => {
    const cases: [string, string, number, RegExp][] = [
      ['leck', 'int *p = malloc(40);\n  p[0] = 1;', 3, /Speicherleck/],
      ['doppelt', 'int *p = malloc(40);\n  free(p);\n  free(p);', 5, /doppeltes free/],
      ['ueber', 'int *p = malloc(4 * sizeof(int));\n  p[4] = 1;\n  free(p);', 3, /Grenzen/],
      ['nach', 'int *p = malloc(16);\n  free(p);\n  p[0] = 7;', 4, /nach diesem free/],
    ];
    for (const [name, body, line, pattern] of cases) {
      const file = write(`speicher/${name}/${name}.c`, `#include <stdlib.h>\nint main(void){\n  ${body}\n  return 0;\n}\n`);
      assert.strictEqual(await runAndWait(file), 0, name);
      const found = await waitFor(`Bericht ${name}`, () => {
        const list = memoryDiagnostics(file);
        return list.length > 0 && list;
      }, 10000);
      assert.ok(pattern.test(found[0].message), `${name}: ${found[0].message}`);
      assert.strictEqual(found[0].range.start.line + 1, line, `${name}: Zeile`);
    }
  });

  await test('Speicherprüfung: sauberes Programm, _strdup und fehlendes include', async () => {
    const clean = write(
      'speicher/gut/gut.c',
      '#include <stdlib.h>\n#include <string.h>\nint main(void){\n  char *s = _strdup("abc");\n  s = realloc(s, 100);\n  free(s);\n  int *p = malloc(8);\n  p = realloc(p, 80);\n  free(p);\n  return 0;\n}\n',
    );
    assert.strictEqual(await runAndWait(clean), 0);
    await sleep(500);
    assert.strictEqual(memoryDiagnostics(clean).length, 0, JSON.stringify(memoryDiagnostics(clean).map((d) => d.message)));
    const missing = write('speicher/ohne/ohne.c', 'int main(void){\n  int *p = malloc(40);\n  return p != 0;\n}\n');
    await open(missing);
    assert.strictEqual(await vscode.commands.executeCommand('hawC.build'), false, 'fehlendes include muss auffallen');
  });

  await test('Speicherprüfung im Makefile-Projekt auf Wunsch', async () => {
    const dir = path.join(workspace, 'mkspeicher');
    fs.cpSync(path.join(templates, 'makefile'), dir, { recursive: true });
    const main = path.join(dir, 'src', 'main.c');
    fs.writeFileSync(main, '#include <stdlib.h>\n#include "rechnen.h"\nint main(void){\n  int *p = malloc(plus(4, 4));\n  return p == 0;\n}\n');
    await open(main);
    api.lastExitCode = undefined;
    await vscode.commands.executeCommand('hawC.runMemory');
    await waitFor('Programmende', () => api.lastExitCode !== undefined);
    const found = await waitFor('Bericht', () => {
      const list = memoryDiagnostics(main);
      return list.length > 0 && list;
    }, 10000);
    assert.strictEqual(found[0].range.start.line + 1, 4);
  });

  await test('Selbsttest: bestanden, falsch, Absturz, Zeitlimit, negative Zahl', async () => {
    const dir = 'aufgabe1';
    const task = (tests: object[], extra: object = {}) =>
      write(`${dir}/aufgabe.json`, JSON.stringify({ name: 'Summe', timeout_sec: 2, ...extra, tests }));
    task([
      { name: 'richtig', input: '3\n4\n', erwartet: '7' },
      { name: 'negativ', input: '5\n-8\n', erwartet: '-3' },
      { name: 'falsch', input: '1\n1\n', erwartet: '-2' },
      { name: 'absturz', input: '-1\n0\n', erwartet: '0' },
      { name: 'endlos', input: '-2\n0\n', erwartet: '0' },
    ]);
    const file = write(
      `${dir}/main.c`,
      '#include <stdio.h>\nint main(void){\n  int a, b;\n  scanf("%d %d", &a, &b);\n  if (a == -1) { int *p = NULL; *p = 1; }\n  while (a == -2) { }\n  printf("Summe: %d\\n", a + b);\n  return 0;\n}\n',
    );
    await open(file);
    await waitFor('Knopf', () => true);
    const results = (await vscode.commands.executeCommand('hawC.check')) as { name: string; passed: boolean; problem?: string }[];
    const state = Object.fromEntries(results.map((result) => [result.name, result.passed]));
    assert.deepStrictEqual(state, { richtig: true, negativ: true, falsch: false, absturz: false, endlos: false });
    assert.ok(/Abgestürzt/.test(results[3].problem ?? ''), results[3].problem);
    assert.ok(/Zeitlimit/.test(results[4].problem ?? ''), results[4].problem);

    task([{ name: 'text', input: '1\n2\n', erwartet: 'Summe: 3' }], { vergleich: 'text' });
    const text = (await vscode.commands.executeCommand('hawC.check')) as { passed: boolean }[];
    assert.strictEqual(text[0].passed, true);
    task([{ name: 'text', input: '1\n2\n', erwartet: 'Summe = 3' }], { vergleich: 'text' });
    const wrong = (await vscode.commands.executeCommand('hawC.check')) as { passed: boolean }[];
    assert.strictEqual(wrong[0].passed, false);
  });

  await test('Vorlage Aufgabe ist gültig', async () => {
    const dir = path.join(workspace, 'aufgabe2');
    fs.cpSync(path.join(templates, 'aufgabe'), dir, { recursive: true });
    await open(path.join(dir, 'main.c'));
    const results = (await vscode.commands.executeCommand('hawC.check')) as { passed: boolean }[];
    assert.strictEqual(results.length, 3);
    assert.ok(results.some((result) => !result.passed), 'die leere Lösung darf nicht bestehen');
  });

  await test('Übersetzungsschritte: Stufen, Symbole und Fehler', async () => {
    const main = write('schritte/main.c', '#include <stdio.h>\n#include "plus.h"\nint main(void){\n  printf("%d", plus(1, 2));\n  return 0;\n}\n');
    write('schritte/plus.c', '#include "plus.h"\nint plus(int a, int b){ return a + b; }\n');
    const header = write('schritte/plus.h', 'int plus(int a, int b);\n');
    await open(main);
    const overview = (await vscode.commands.executeCommand('hawC.steps')) as string;
    const text = fs.readFileSync(overview, 'utf8');
    const folder = path.dirname(overview);
    for (const name of ['main.i', 'main.s', 'main.o', 'plus.o', 'programm.exe']) {
      assert.ok(fs.existsSync(path.join(folder, name)), name);
    }
    assert.ok(/Präprozessor/.test(text) && /Linker/.test(text), text);
    assert.ok(/Bietet an: `main`/.test(text), text);
    assert.ok(/Braucht noch:.*`plus`/.test(text), text);
    assert.ok(/Bietet an: `plus`/.test(text), text);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(main)).sort(), ['main.c', 'plus.c', 'plus.h']);

    fs.writeFileSync(header, 'int plus(int a int b);\n');
    await open(main);
    const broken = fs.readFileSync((await vscode.commands.executeCommand('hawC.steps')) as string, 'utf8');
    assert.ok(/fehlgeschlagen/.test(broken), broken);
    fs.writeFileSync(header, 'int plus(int a, int b);\n');

    const dir = path.join(workspace, 'schrittemk');
    fs.cpSync(path.join(templates, 'makefile'), dir, { recursive: true });
    await open(path.join(dir, 'src', 'main.c'));
    const made = fs.readFileSync((await vscode.commands.executeCommand('hawC.steps')) as string, 'utf8');
    assert.ok(/gcc .*-c src\/main\.c/.test(made), made);
  });

  await test('Menü Run ohne offene Datei: keine Debugger-Auswahl', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await Promise.race([
      vscode.commands.executeCommand('workbench.action.debug.start'),
      sleep(15000).then(() => {
        throw new Error('Der Befehl kehrt nicht zurück, vermutlich ist die Debugger-Auswahl offen.');
      }),
    ]);
    assert.strictEqual(vscode.debug.activeDebugSession, undefined);
  });

  await test('Menü Run: Ausführen ohne Debugging', async () => {
    const file = write('menue/lauf.c', 'int main(void){return 7;}\n');
    await open(file);
    api.lastExitCode = undefined;
    await vscode.commands.executeCommand('workbench.action.debug.run');
    await waitFor('Programmende', () => api.lastExitCode !== undefined, 30000);
    assert.strictEqual(api.lastExitCode, 7);
  });

  await test('Menü Run: Debugging starten', async () => {
    const file = write('menue/dbg.c', 'int main(void){\n  int *p = 0;\n  *p = 1;\n  return 0;\n}\n');
    await open(file);
    const stopped = watchDebugger();
    await vscode.commands.executeCommand('workbench.action.debug.start');
    const session = await waitFor('Debug-Sitzung', () => vscode.debug.activeDebugSession, 30000);
    await waitFor('Halt im Debugger', () => stopped.events.length > 0, 30000);
    const stack = await session.customRequest('stackTrace', { threadId: stopped.events[0].body.threadId });
    assert.strictEqual(stack.stackFrames[0].line, 3);
    await vscode.debug.stopDebugging(session);
    await waitFor('Debug-Ende', () => !vscode.debug.activeDebugSession);
    stopped.dispose();
  });

  fs.writeFileSync(path.join(path.dirname(kit.storage), 'haw-c-ergebnis.txt'), results.join('\n'), 'utf8');
  console.log(results.join('\n'));
  if (failures.length > 0) {
    throw new Error(`${failures.length} Test(s) fehlgeschlagen: ${failures.join(', ')}`);
  }
}

let lastDefinition: vscode.Location | vscode.LocationLink | undefined;

/** Sammelt die stopped-Ereignisse des Debug-Adapters. */
function watchDebugger() {
  const events: { body: { reason: string; threadId: number } }[] = [];
  const registration = vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', {
    createDebugAdapterTracker: () => ({
      onDidSendMessage: (message: { type: string; event?: string; body: { reason: string; threadId: number } }) => {
        if (message.type === 'event' && message.event === 'stopped') {
          events.push({ body: message.body });
        }
        if (message.type === 'event' && message.event === 'output') {
          console.log(`DBG ${JSON.stringify(message.body).slice(0, 300)}`);
        }
        if (message.type === 'response' && (message as unknown as { success: boolean }).success === false) {
          console.log(`DBG FEHLER ${JSON.stringify(message).slice(0, 500)}`);
        }
      },
      onError: (error: Error) => console.log(`DBG onError ${error.message}`),
      onExit: (code: number | undefined, signal: string | undefined) => console.log(`DBG onExit ${code} ${signal}`),
    }),
  });
  return { events, dispose: () => registration.dispose() };
}
