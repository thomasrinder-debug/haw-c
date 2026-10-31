// Wertet die Textausgabe von gcc, ld und make aus. JSON geht nicht, weil fremde
// Makefiles ihre Flags selbst bestimmen. Die Verzeichnisse kommen aus make -w.
import * as path from 'path';
import * as vscode from 'vscode';

export interface Finding {
  file: string;
  line: number;
  column: number;
  severity: vscode.DiagnosticSeverity;
  message: string;
}

const GCC_LINE = /^(.+?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.*)$/;
const MAKE_ENTER = /^\S*make(?:\.exe)?(?:\[\d+\])?: Entering directory [`'](.*)'$/;
const MAKE_LEAVE = /^\S*make(?:\.exe)?(?:\[\d+\])?: Leaving directory [`'](.*)'$/;
const MAKE_ERROR = /^(.+?):(\d+): \*\*\* (.*)$/;
const LD_REFERENCE = /(?:^|: )(?:([A-Za-z]:[^:]*|[^:]+?):(\d+):\(.*?\): )?undefined reference to [`'](.*?)'/;

/** Deutsche Hinweise zu den häufigsten Meldungen der Anfänger. */
const HINTS: [RegExp, string][] = [
  [/expected ';'|expected ',' or ';'/, 'Hier fehlt vermutlich ein Semikolon, oft am Ende der Zeile davor.'],
  [/undeclared/, 'Der Name ist hier nicht deklariert. Tippfehler, oder die Variable fehlt.'],
  [/implicit declaration of function/, 'Die Funktion ist nicht bekannt: Fehlt ein #include oder ein Prototyp?'],
  [/format '%.*' expects/, 'Das Format in printf oder scanf passt nicht zum Datentyp des Arguments.'],
  [/No such file or directory/, 'Die Datei wurde nicht gefunden. Name und Include-Pfad prüfen.'],
  [/missing separator/, 'Im Makefile müssen Befehlszeilen mit einem Tabulator beginnen, nicht mit Leerzeichen.'],
  [/No rule to make target/, 'Für diese Datei kennt das Makefile keine Regel. Pfad im Makefile prüfen.'],
  [/control reaches end of non-void/, 'Die Funktion erreicht ihr Ende, ohne etwas mit return zurückzugeben.'],
];

export function hintFor(message: string): string | undefined {
  return HINTS.find(([pattern]) => pattern.test(message))?.[1];
}

/** Hinweise, die für die ganze Ausgabe gelten und zu keiner Zeile gehören. */
export function generalHints(output: string): string[] {
  const hints: string[] = [];
  if (/undefined reference to `(WinMain|main)'/.test(output)) {
    hints.push('Es fehlt eine Funktion main. Ist die richtige Datei aktiv?');
  } else if (/undefined reference to/.test(output)) {
    hints.push(
      'Der Linker findet eine Funktion nicht. Ist sie geschrieben, und liegt ihre .c-Datei im ' +
        'selben Ordner oder in src bzw. lib? Eine Bibliothek braucht ein Makefile.',
    );
  }
  if (/cannot open output file .*Permission denied/.test(output)) {
    hints.push('Das Programm läuft noch und lässt sich nicht überschreiben. Bitte erst beenden.');
  }
  if (/file format not recognized|file not recognized|\.so: /.test(output)) {
    hints.push('Eine Bibliothek passt nicht zu diesem Compiler: .so aus Linux geht hier nicht.');
  }
  return hints;
}

export function parseOutput(output: string, startDir: string): Finding[] {
  const findings: Finding[] = [];
  const dirs = [startDir];
  const resolve = (file: string) => path.resolve(dirs[dirs.length - 1], file);
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let match = MAKE_ENTER.exec(line);
    if (match) {
      dirs.push(match[1]);
      continue;
    }
    if (MAKE_LEAVE.test(line)) {
      if (dirs.length > 1) {
        dirs.pop();
      }
      continue;
    }
    match = GCC_LINE.exec(line);
    if (match) {
      if (match[4] === 'note') {
        continue;
      }
      const message = match[5];
      const hint = hintFor(message);
      findings.push({
        file: resolve(match[1]),
        line: Number(match[2]),
        column: Number(match[3]),
        severity: match[4] === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
        message: hint ? `${message}\n${hint}` : message,
      });
      continue;
    }
    match = MAKE_ERROR.exec(line);
    if (match) {
      const hint = hintFor(match[3]);
      findings.push({
        file: resolve(match[1]),
        line: Number(match[2]),
        column: 1,
        severity: vscode.DiagnosticSeverity.Error,
        message: hint ? `${match[3]}\n${hint}` : match[3],
      });
      continue;
    }
    match = LD_REFERENCE.exec(line);
    if (match?.[1]) {
      findings.push({
        file: resolve(match[1]),
        line: Number(match[2]),
        column: 1,
        severity: vscode.DiagnosticSeverity.Error,
        message: `Linker: Funktion „${match[3]}“ nicht gefunden.`,
      });
    }
  }
  return findings;
}

export function publish(collection: vscode.DiagnosticCollection, findings: Finding[]): void {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const finding of findings) {
    const line = Math.max(finding.line - 1, 0);
    const column = Math.max(finding.column - 1, 0);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, column, line, column + 1),
      finding.message,
      finding.severity,
    );
    diagnostic.source = 'gcc';
    const list = byFile.get(finding.file) ?? [];
    list.push(diagnostic);
    byFile.set(finding.file, list);
  }
  collection.clear();
  for (const [file, list] of byFile) {
    collection.set(vscode.Uri.file(file), list);
  }
}
