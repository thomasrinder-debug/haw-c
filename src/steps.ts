// Zeigt die Stufen des Übersetzens einzeln: Präprozessor, Compiler, Assembler,
// Linker. Die Zwischenergebnisse landen im Speicherbereich, nicht im Projekt.
import * as fs from 'fs';
import * as path from 'path';
import { Kit, run, shortPath } from './kit';
import { hash, includeDirs, Project } from './project';

function countLines(text: string): number {
  return text.split('\n').length;
}

function link(file: string): string {
  return `[${path.basename(file)}](${encodeURI(`file:///${file.replace(/\\/g, '/')}`)})`;
}

function block(command: string): string {
  return ['```text', command, '```'].join('\n');
}

/** Beschreibt die Symbole einer Objektdatei: was sie anbietet und was sie noch braucht. */
function describeSymbols(table: string): { defined: string[]; undefinedNames: string[] } {
  const defined: string[] = [];
  const undefinedNames: string[] = [];
  for (const line of table.split(/\r?\n/)) {
    const match = /^\s*(?:[0-9a-fA-F]+\s+)?([A-Za-z])\s+(\S+)$/.exec(line);
    if (!match || match[2].startsWith('.') || match[2].startsWith('__')) {
      continue;
    }
    if (match[1] === 'U') {
      undefinedNames.push(match[2]);
    } else if (match[1] === 'T' || match[1] === 'D' || match[1] === 'B') {
      defined.push(match[2]);
    }
  }
  return { defined, undefinedNames };
}

/** Erzeugt die Übersicht und gibt ihren Pfad zurück. */
export async function writeSteps(kit: Kit, project: Project): Promise<string> {
  const target = path.join(kit.storage, 'schritte', hash(project.dir));
  await fs.promises.rm(target, { recursive: true, force: true });
  await fs.promises.mkdir(target, { recursive: true });
  const overview = path.join(target, 'uebersicht.md');
  const env = kit.env();
  const cwd = shortPath(project.dir);
  const out: string[] = ['# Übersetzungsschritte', ''];

  if (project.kind === 'make') {
    const { output } = await run(kit.tool('make'), ['-Bn'], { cwd, env, check: false });
    out.push(
      'Dieses Projekt baut `make`. `make -n` zeigt die Befehle, ohne sie auszuführen. Jeder `gcc`-Aufruf mit `-c`',
      'übersetzt eine Datei in eine Objektdatei (`.o`), der Aufruf ohne `-c` bindet sie zum Programm zusammen.',
      '',
      block(output.trim()),
    );
    await fs.promises.writeFile(overview, out.join('\n'));
    return overview;
  }

  const flags = ['-std=c17', '-Wall', '-Wextra', ...includeDirs(project.dir).map((name) => `-I${name}`)];
  const objects: string[] = [];
  out.push(
    'Hier sehen Sie, was `gcc` beim Übersetzen in vier Schritten tut. Der Klarheit wegen ohne die Prüfungen,',
    'die ▶ zusätzlich einschaltet (`-g -O0 -fsanitize=undefined -fsanitize-trap` und die Speicherprüfung).',
    '',
  );
  const step = async (args: string[]) => {
    const result = await run(kit.tool('gcc'), args, { cwd, env, check: false });
    if (result.code !== 0) {
      out.push(block(`gcc ${args.join(' ')}`), '', 'Dieser Schritt ist fehlgeschlagen:', '', block(result.output.trim()));
      await fs.promises.writeFile(overview, out.join('\n'));
    }
    return result.code === 0;
  };

  for (const source of project.sources) {
    const relative = path.relative(project.dir, source);
    const base = path.basename(source, '.c');
    const preprocessed = path.join(target, `${base}.i`);
    const assembler = path.join(target, `${base}.s`);
    const object = path.join(target, `${base}.o`);
    out.push(`## ${relative}`, '', '### 1. Präprozessor', '');
    out.push('Setzt die Header ein, ersetzt Makros und entfernt Kommentare. Heraus kommt reiner C-Text.', '');
    if (!(await step(['-E', ...flags, relative, '-o', preprocessed]))) {
      return overview;
    }
    const sourceLines = countLines(await fs.promises.readFile(source, 'utf8'));
    const preLines = countLines(await fs.promises.readFile(preprocessed, 'utf8'));
    out.push(block(`gcc -E ${flags.join(' ')} ${relative} -o ${base}.i`), '');
    out.push(`Aus ${sourceLines} Zeilen werden ${preLines} Zeilen: ${link(preprocessed)}`, '');

    out.push('### 2. Compiler', '', 'Prüft den C-Code und übersetzt ihn in Assembler.', '');
    if (!(await step(['-S', ...flags, relative, '-o', assembler]))) {
      return overview;
    }
    out.push(block(`gcc -S ${flags.join(' ')} ${relative} -o ${base}.s`), '', `Ergebnis: ${link(assembler)}`, '');

    out.push('### 3. Assembler', '', 'Erzeugt Maschinencode in einer Objektdatei. Fremde Funktionen sind noch offen.', '');
    if (!(await step(['-c', ...flags, relative, '-o', object]))) {
      return overview;
    }
    objects.push(object);
    out.push(block(`gcc -c ${flags.join(' ')} ${relative} -o ${base}.o`), '');
    const table = await run(kit.tool('nm'), [object], { env, check: false });
    const { defined, undefinedNames } = describeSymbols(table.output);
    out.push(`- Bietet an: ${defined.map((name) => `\`${name}\``).join(', ') || 'nichts'}`);
    out.push(`- Braucht noch: ${undefinedNames.map((name) => `\`${name}\``).join(', ') || 'nichts'}`, '');
  }

  const program = path.join(target, 'programm.exe');
  out.push('## 4. Linker', '');
  out.push('Fügt die Objektdateien und die Bibliotheken zusammen und löst alle offenen Namen auf.', '');
  const objectNames = objects.map((object) => path.basename(object)).join(' ');
  out.push(block(`gcc ${objectNames} -o programm.exe -lm`), '');
  const linked = await run(kit.tool('gcc'), [...objects, '-o', program, '-lm'], { cwd, env, check: false });
  if (linked.code !== 0) {
    out.push('Dieser Schritt ist fehlgeschlagen:', '', block(linked.output.trim()));
  } else {
    const size = (await fs.promises.stat(program)).size;
    out.push(`Ergebnis: \`programm.exe\` mit ${Math.round(size / 1024)} KB.`);
  }
  await fs.promises.writeFile(overview, out.join('\n'));
  return overview;
}
