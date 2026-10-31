// Nimmt das Anleitungsvideo auf: startet ein eigenes VS Code mit frischem Profil,
// steuert es über das Chrome DevTools Protocol und speichert nur
// dieses Fenster. Der Mauszeiger und die Untertitel sind Einblendungen fürs Video.
// Aufruf: node docs/video/aufnehmen.mjs [nur=szene1,szene2]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
// Außerhalb des Benutzerprofils, damit kein Benutzername im Bild erscheinen kann.
const sandbox = 'C:\\temp\\HAW-Video';
const demo = 'C:\\temp\\HAW-Demo';
const frames = path.join(sandbox, 'bilder');
const WIDTH = 1280;
const HEIGHT = 720;
const PORT = 9333;
const only = process.argv.find((arg) => arg.startsWith('nur='))?.slice(4).split(',');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Stimme: Piper mit „thorsten-high“ (offline, Datensatz CC0). HAW_PIPER zeigt auf einen
// Ordner mit venv (pip install piper-tts) und dem Modell de.onnx samt de.onnx.json.
const PIPER = process.env.HAW_PIPER;

// Je Einsatz: Untertitel und gesprochener Text. Die Stimme trifft englische Fachwörter
// schlecht. Gesprochen wird deshalb „Fehlersuche“ und „Kopfdatei“, und Abkürzungen
// stehen nach Aussprache („V S Code“, „Ze“). Die Untertitel nennen die Fachwörter.
const TEXT = {
  titel: ['HAW Kiel C: C-Programme in VS Code, ohne Einrichtung', 'Mit der Erweiterung H A W Kiel Ze schreiben und starten Sie Ze-Programme in V S Code. Compiler und Werkzeuge zur Fehlersuche sind schon dabei, Sie müssen nichts einrichten.'],
  oeffnen: ['Eine .c-Datei öffnen: Oben rechts erscheinen die Knöpfe', 'Öffnen Sie eine Datei mit der Endung Punkt Ze. Oben rechts im Editor erscheinen dann die Knöpfe zum Ausführen und für die Fehlersuche.'],
  klick: ['Ein Klick auf Ausführen', 'Ein Klick auf Ausführen genügt.'],
  terminal: ['Speichern, übersetzen, starten: Die Ausgabe steht im Terminal', 'Die Datei wird gespeichert und übersetzt, dann startet das Programm. Seine Ausgabe steht unten im Terminal, hier die Summe zehn.'],
  fehler: ['Ein Fehler im Code: Das Semikolon fehlt', 'Was passiert bei einem Fehler? Dazu lösche ich das Semikolon am Ende dieser Zeile und starte erneut.'],
  problem: ['Der Fehler steht im Code und im Problemfenster, mit deutschem Hinweis', 'Das Programm startet jetzt nicht. Die Stelle ist im Code markiert. Das Problemfenster nennt die englische Meldung des Compilers und darunter einen deutschen Hinweis.'],
  haltepunkt: ['Haltepunkt setzen (F9), dann Debuggen (F5)', 'Für die Fehlersuche setze ich mit der Taste F neun einen Haltepunkt und drücke dann F fünf.'],
  haelt: ['Das Programm hält an dieser Zeile an', 'Das Programm hält an dieser Zeile an. Ein- und Ausgaben laufen dabei in einem eigenen Fenster.'],
  variablen: ['Links stehen die Variablen mit ihren Werten', 'Links sehen Sie die Variablen mit ihren aktuellen Werten.'],
  weiter: ['Weiter mit F5: Die Werte ändern sich', 'Mit F fünf läuft das Programm bis zum nächsten Halt, und die Werte ändern sich.'],
  mehrere: ['Mehrere .c-Dateien und eigene Header gehen ohne Makefile', 'Programme aus mehreren Dateien laufen ohne jede Einstellung. Hier gehören zwei Quelldateien und eine eigene Kopfdatei zusammen.'],
  gemeinsam: ['main.c und rechnen.c werden gemeinsam übersetzt', 'Die Erweiterung erkennt das selbst und übersetzt beide Dateien gemeinsam.'],
  anzahl: ['Unten links steht, wie viele Dateien zum Programm gehören', 'Unten links steht, wie viele Dateien zum Programm gehören. Bringt das Projekt eine eigene Bauanleitung mit, wird sie benutzt.'],
  speicher: ['Die Speicherprüfung läuft immer mit', 'Die Speicherprüfung läuft immer mit. In diesem Programm wird Speicher angefordert, aber nie freigegeben.'],
  leck: ['Am Ende meldet sie das Speicherleck mit der Zeile', 'Am Programmende meldet sie das Speicherleck mit der genauen Zeile, im Terminal und im Problemfenster.'],
  aufgabe: ['Selbsttest: Eine aufgabe.json enthält die Testfälle', 'Für Übungsaufgaben können Sie Ihre Lösung selbst testen. Die Testfälle stehen in einer Datei im Projektordner, die Ihre Lehrkraft vorgibt.'],
  pruefen: ['Aufgabe prüfen zeigt, welche Tests bestehen …', 'Der Knopf Aufgabe prüfen startet alle Tests und zeigt, welche bestehen.'],
  abweichung: ['… und bei Fehlern Eingabe, Erwartung und tatsächliche Ausgabe', 'Hier ist einer falsch. Sie sehen die Eingabe, das erwartete Ergebnis und was Ihr Programm tatsächlich ausgegeben hat.'],
  menue: ['Das Menü HAW Kiel C steht unten links', 'Weitere Befehle stehen im Menü H A W Kiel Ze, unten links in der Statusleiste.'],
  schritte: ['Übersetzungsschritte zeigen, was gcc einzeln tut', 'Der Befehl Übersetzungsschritte zeigt, was der Compiler im Einzelnen tut.'],
  stufen: ['Präprozessor, Compiler, Assembler und Linker, mit den Zwischendateien', 'Sie sehen Präprozessor, Compiler, Assembler und zuletzt den Linker, jeweils mit dem Befehl und den Zwischendateien.'],
  ende: ['Installation und Hilfe: github.com/thomasrinder-debug/haw-c', 'Die Installation und Hilfe bei Problemen finden Sie auf der Projektseite bei Git Hab. Viel Erfolg beim Programmieren!'],
};

const speech = new Map();
const cues = [];

/** Erzeugt alle Sätze vorab, damit das Sprechen die Aufnahme nicht aufhält. */
function synthesize() {
  if (!PIPER) {
    throw new Error('HAW_PIPER ist nicht gesetzt.');
  }
  const dir = path.join(sandbox, 'ton');
  fs.mkdirSync(dir, { recursive: true });
  for (const [key, [, spoken]] of Object.entries(TEXT)) {
    const file = path.join(dir, `${key}.wav`);
    const result = spawnSync(
      path.join(PIPER, 'venv', 'Scripts', 'python.exe'),
      ['-m', 'piper', '-m', path.join(PIPER, 'de.onnx'), '-f', file, '--length-scale', '1.05'],
      { input: spoken, env: { ...process.env, PYTHONUTF8: '1' }, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr);
    }
    // 16 Bit, Mono, 22 050 Hz; der Kopf einer WAV-Datei hat hier 44 Bytes.
    const seconds = (fs.statSync(file).size - 44) / (2 * 22050);
    speech.set(key, { file, seconds });
  }
  const total = [...speech.values()].reduce((sum, line) => sum + line.seconds, 0);
  console.log(`Sprecher: ${speech.size} Sätze, ${total.toFixed(0)} s`);
}

function codeExecutable() {
  const base = path.join(root, '.vscode-test');
  const dir = fs.readdirSync(base).find((name) => name.startsWith('vscode-win32-x64-archive'));
  return path.join(base, dir);
}

function prepareDemo() {
  fs.rmSync(demo, { recursive: true, force: true });
  const write = (name, text) => {
    const file = path.join(demo, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write(
    '1_Hallo/hallo.c',
    '#include <stdio.h>\n\nint main(void)\n{\n    int summe = 0;\n    for (int i = 1; i <= 4; i++) {\n        summe += i;\n    }\n    printf("Summe: %d\\n", summe);\n    return 0;\n}\n',
  );
  write('2_Projekt/main.c', '#include <stdio.h>\n#include "rechnen.h"\n\nint main(void)\n{\n    printf("2 + 3 = %d\\n", plus(2, 3));\n    return 0;\n}\n');
  write('2_Projekt/rechnen.c', '#include "rechnen.h"\n\nint plus(int a, int b)\n{\n    return a + b;\n}\n');
  write('2_Projekt/rechnen.h', '#ifndef RECHNEN_H\n#define RECHNEN_H\n\nint plus(int a, int b);\n\n#endif\n');
  write('3_Speicher/feld.c', '#include <stdlib.h>\n\nint main(void)\n{\n    int *feld = malloc(10 * sizeof(int));\n    feld[0] = 1;\n    return 0;\n}\n');
  write(
    '4_Aufgabe/aufgabe.json',
    JSON.stringify(
      {
        name: 'Summe zweier Zahlen',
        tests: [
          { name: 'Positive Zahlen', input: '3\n4\n', erwartet: '7' },
          { name: 'Mit negativer Zahl', input: '5\n-8\n', erwartet: '-3' },
        ],
      },
      null,
      2,
    ),
  );
  // Mit Absicht falsch: abs liefert bei negativer Summe das falsche Vorzeichen.
  write('4_Aufgabe/main.c', '#include <stdio.h>\n#include <stdlib.h>\n\nint main(void)\n{\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("Summe: %d\\n", abs(a + b));\n    return 0;\n}\n');
}

function prepareProfile() {
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  const settings = path.join(sandbox, 'daten', 'User');
  fs.mkdirSync(settings, { recursive: true });
  fs.writeFileSync(
    path.join(settings, 'settings.json'),
    JSON.stringify({
      'workbench.startupEditor': 'none',
      'workbench.tips.enabled': false,
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      'workbench.colorTheme': 'Default Light Modern',
      'chat.disableAIFeatures': true,
      'chat.commandCenter.enabled': false,
      'window.commandCenter': false,
      'update.mode': 'none',
      'extensions.ignoreRecommendations': true,
      'telemetry.telemetryLevel': 'off',
      'editor.minimap.enabled': false,
      'editor.fontSize': 16,
      'terminal.integrated.fontSize': 15,
      'editor.quickSuggestions': { other: false, comments: false, strings: false },
      'editor.suggestOnTriggerCharacters': false,
      'editor.parameterHints.enabled': false,
      'git.enabled': false,
      'debug.internalConsoleOptions': 'neverOpen',
      'debug.toolBarLocation': 'floating',
      'security.workspace.trust.enabled': false,
    }),
  );
  const cli = path.join(codeExecutable(), 'bin', 'code.cmd');
  const vsix = fs.readdirSync(root).find((name) => name.endsWith('.vsix'));
  const dirs = [`"--extensions-dir=${path.join(sandbox, 'ext')}"`, `"--user-data-dir=${path.join(sandbox, 'daten')}"`];
  const install = spawnSync(
    `"${cli}"`,
    [...dirs, '--install-extension', `"${path.join(root, vsix)}"`],
    { shell: true, encoding: 'utf8' },
  );
  console.log(install.stdout.split('\n').filter((line) => /installed|Failed/.test(line)).join('\n'));
}

async function launch() {
  const exe = path.join(codeExecutable(), 'Code.exe');
  const child = spawn(
    exe,
    [
      demo,
      `--user-data-dir=${path.join(sandbox, 'daten')}`,
      `--extensions-dir=${path.join(sandbox, 'ext')}`,
      `--remote-debugging-port=${PORT}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
    { stdio: 'ignore', detached: false },
  );
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    await sleep(1000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => undefined);
  }
  if (!browser) {
    throw new Error('VS Code antwortet nicht.');
  }
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes('workbench'));
    if (!page) {
      await sleep(500);
    }
  }
  await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
  return { child, browser, page };
}

async function setWindowSize(page) {
  const cdp = await page.context().newCDPSession(page);
  // Unabhängig von der echten Fenstergröße: Die Seite rechnet und zeichnet mit dieser Größe.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  return cdp;
}

/** Einblendungen: Untertitel und Mauszeiger. Sie gehören nicht zu VS Code. */
async function installOverlay(page) {
  await page.evaluate(() => {
    const caption = document.createElement('div');
    caption.id = 'haw-caption';
    caption.style.cssText =
      'position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:100000;background:#123c69;color:#fff;' +
      'font:600 22px Segoe UI,sans-serif;padding:10px 22px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);' +
      'max-width:86%;text-align:center;opacity:0;transition:opacity .25s;pointer-events:none';
    const cursor = document.createElement('div');
    cursor.id = 'haw-cursor';
    cursor.style.cssText =
      'position:fixed;left:640px;top:360px;width:22px;height:22px;z-index:100001;pointer-events:none;background:#111;' +
      'clip-path:polygon(0 0,0 100%,28% 74%,48% 100%,62% 92%,44% 66%,78% 66%);transition:left .6s ease,top .6s ease;' +
      'filter:drop-shadow(0 0 2px #fff)';
    const ring = document.createElement('div');
    ring.id = 'haw-ring';
    ring.style.cssText =
      'position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #e8590c;border-radius:50%;z-index:100000;' +
      'pointer-events:none;opacity:0;transition:opacity .4s';
    document.body.append(caption, cursor, ring);
  });
}

function actions(page) {
  const caption = async (text, ms = 2200, top = false) => {
    await page.evaluate(
      ([value, atTop]) => {
        const element = document.getElementById('haw-caption');
        element.textContent = value;
        element.style.opacity = value ? '1' : '0';
        element.style.bottom = atTop ? 'auto' : '44px';
        element.style.top = atTop ? '250px' : 'auto';
      },
      [text, top],
    );
    await sleep(ms);
  };
  const moveTo = async (x, y) => {
    await page.evaluate(
      ([left, top]) => {
        const cursor = document.getElementById('haw-cursor');
        cursor.style.left = `${left}px`;
        cursor.style.top = `${top}px`;
      },
      [x, y],
    );
    await sleep(700);
  };
  const clickAt = async (x, y) => {
    await moveTo(x, y);
    await page.evaluate(
      ([left, top]) => {
        const ring = document.getElementById('haw-ring');
        ring.style.left = `${left}px`;
        ring.style.top = `${top}px`;
        ring.style.opacity = '1';
        setTimeout(() => (ring.style.opacity = '0'), 450);
      },
      [x, y],
    );
    await page.mouse.click(x, y);
    await sleep(350);
  };
  const click = async (selector) => {
    const element = page.locator(selector).first();
    await element.waitFor({ state: 'visible', timeout: 30000 });
    const box = await element.boundingBox();
    await clickAt(box.x + box.width / 2, box.y + box.height / 2);
  };
  const palette = async (text) => {
    await page.keyboard.press('Control+Shift+P');
    await sleep(350);
    await page.keyboard.type(text, { delay: 18 });
    await sleep(450);
    await page.keyboard.press('Enter');
    await sleep(500);
  };
  const openFile = async (name) => {
    await page.keyboard.press('Control+P');
    await sleep(300);
    await page.keyboard.type(name, { delay: 22 });
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(900);
  };
  const goToLine = async (line) => {
    // Nach dem Start liegt der Fokus im Terminal, dort bedeutet Strg+G etwas anderes.
    await page.keyboard.press('Control+1');
    await sleep(200);
    await page.keyboard.press('Control+G');
    await sleep(200);
    await page.keyboard.type(String(line));
    await page.keyboard.press('Enter');
    await sleep(250);
  };
  /** Blendet den Untertitel ein, merkt sich den Einsatz des Sprechers und wartet, bis er fertig ist. */
  const say = async (key, top = false) => {
    const line = speech.get(key);
    cues.push({ file: line.file, at: Date.now() / 1000 });
    await caption(TEXT[key][0], line.seconds * 1000 + 450, top);
  };
  return { caption, say, moveTo, clickAt, click, palette, openFile, goToLine };
}

const RUN = '.editor-actions [aria-label^="Ausführen"], .editor-actions a[aria-label*="Ausführen"]';
const CHECK = '.editor-actions a[aria-label*="Aufgabe prüfen"]';
const STATUS = '.statusbar-item[id*="thomasrinder.haw-c"], .statusbar-item[aria-label*="HAW Kiel C"]';

/** Die Szenen. Jede beginnt mit Editoren und Panel im Ruhezustand. */
function scenes(page, a) {
  const closeAll = async () => {
    await a.palette('View: Close All Editors');
    await sleep(300);
  };
  return {
    start: async () => {
      await a.say('titel');
      await a.openFile('hallo.c');
      await a.say('oeffnen');
      await a.say('klick');
      await a.click(RUN);
      await sleep(900);
      await a.say('terminal');
    },
    fehler: async () => {
      await a.goToLine(7);
      await page.keyboard.press('End');
      await a.say('fehler');
      await page.keyboard.press('Backspace');
      await sleep(800);
      await a.click(RUN);
      await sleep(900);
      await a.say('problem');
      await a.goToLine(7);
      await page.keyboard.press('End');
      await page.keyboard.type(';');
      await sleep(400);
    },
    debuggen: async () => {
      await a.goToLine(7);
      await page.keyboard.press('F9');
      await a.say('haltepunkt');
      await page.keyboard.press('F5');
      await page.waitForSelector('.debug-toolbar', { timeout: 40000 }).catch(() => undefined);
      await sleep(800);
      await a.say('haelt');
      await a.click('.debug-pane .monaco-list-row[aria-label*="Locals"]');
      await a.say('variablen');
      await page.keyboard.press('F5');
      await sleep(900);
      await a.say('weiter');
      await page.keyboard.press('Shift+F5');
      await sleep(1200);
      await page.keyboard.press('Control+Shift+E');
      await sleep(300);
      await a.goToLine(7);
      await page.keyboard.press('F9');
      await sleep(300);
    },
    projekt: async () => {
      await closeAll();
      await a.openFile('2_Projekt/main.c');
      await a.say('mehrere');
      await a.click(RUN);
      await sleep(900);
      await a.say('gemeinsam');
      await a.moveTo(90, 700);
      await a.say('anzahl');
    },
    speicher: async () => {
      await closeAll();
      await a.openFile('feld.c');
      await a.say('speicher');
      await a.click(RUN);
      await sleep(1200);
      await a.say('leck');
    },
    aufgabe: async () => {
      await closeAll();
      await a.openFile('4_Aufgabe/main.c');
      await a.say('aufgabe');
      await a.click(CHECK);
      await sleep(1000);
      await a.say('pruefen', true);
      await a.say('abweichung', true);
    },
    schritte: async () => {
      await closeAll();
      await a.openFile('hallo.c');
      await a.say('menue');
      await a.click(STATUS);
      await sleep(700);
      await page.keyboard.type('Übersetzungsschritte', { delay: 30 });
      await a.say('schritte');
      await page.keyboard.press('Enter');
      await sleep(900);
      await a.say('stufen');
      await a.say('ende');
      await a.caption('', 300);
    },
  };
}

async function record(page, cdp, run) {
  const list = [];
  let index = 0;
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = `f${String(index++).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(frames, file), Buffer.from(data, 'base64'));
    list.push({ file, time: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
  await run();
  await sleep(1000);
  await cdp.send('Page.stopScreencast');
  return list;
}

function encode(list) {
  const concat = path.join(sandbox, 'bilder.txt');
  const lines = [];
  for (let i = 0; i < list.length; i++) {
    const duration = i + 1 < list.length ? list[i + 1].time - list[i].time : 2;
    lines.push(`file '${path.join(frames, list[i].file).replace(/\\/g, '/')}'`, `duration ${duration.toFixed(3)}`);
  }
  lines.push(`file '${path.join(frames, list[list.length - 1].file).replace(/\\/g, '/')}'`);
  fs.writeFileSync(concat, lines.join('\n'));
  const out = path.join(here, 'anleitung.mp4');
  const scale = `scale=${WIDTH}:-2:flags=lanczos,fps=25,format=yuv420p`;
  // Jeder Satz kommt an seinen Einsatz, bezogen auf das erste Bild.
  const start = list[0].time;
  const rate = 22050;
  const pcm = Buffer.alloc(Math.ceil((list.at(-1).time - start + 3) * rate) * 2);
  for (const cue of cues) {
    const sample = fs.readFileSync(cue.file).subarray(44);
    const offset = Math.max(0, Math.round((cue.at - start) * rate)) * 2;
    sample.copy(pcm, offset);
  }
  const voice = path.join(sandbox, 'ton.raw');
  fs.writeFileSync(voice, pcm);
  const result = spawnSync(
    ffmpeg.path,
    [
      '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat,
      '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', voice,
      '-af', 'aformat=channel_layouts=mono,loudnorm=I=-16:TP=-1.5,aresample=44100,aformat=channel_layouts=stereo', '-vf', scale,
      '-c:v', 'libx264', '-crf', '28', '-preset', 'slow',
      '-c:a', 'aac', '-b:a', '96k', '-strict', 'experimental', '-shortest', '-movflags', '+faststart', out,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  // Das GIF für die README: kleiner und mit wenigen Bildern je Sekunde.
  const gif = path.join(here, 'anleitung.gif');
  const filter =
    'fps=5,scale=860:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle';
  const made = spawnSync(ffmpeg.path, ['-y', '-loglevel', 'error', '-i', out, '-filter_complex', filter, gif], { encoding: 'utf8' });
  if (made.status !== 0) {
    throw new Error(made.stderr);
  }
  return out;
}

async function main() {
  prepareDemo();
  prepareProfile();
  synthesize();
  const { child, browser, page } = await launch();
  try {
    const cdp = await setWindowSize(page);
    await sleep(4000);
    await installOverlay(page);
    const a = actions(page);
    // Einrichtung vorab, das Entpacken gehört nicht ins Video.
    await a.openFile('hallo.c');
    const storage = path.join(sandbox, 'daten', 'User', 'globalStorage', 'thomasrinder.haw-c');
    for (let i = 0; i < 180; i++) {
      const ready = fs.existsSync(storage) && fs.readdirSync(storage).some((name) => name.endsWith('.specs'));
      if (ready) {
        break;
      }
      await sleep(1000);
    }
    await sleep(15000);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    fs.writeFileSync(path.join(sandbox, 'vorher.jpg'), Buffer.from(shot.data, 'base64'));
    await a.palette('View: Close All Editors');
    await a.palette('Notifications: Clear All Notifications');
    const all = scenes(page, a);
    const names = only ?? Object.keys(all);
    const list = await record(page, cdp, async () => {
      for (const name of names) {
        console.log(`Szene ${name}`);
        await all[name]();
      }
    });
    const seconds = list.at(-1).time - list[0].time;
    console.log(`${list.length} Bilder, ${seconds.toFixed(1)} s`);
    console.log(encode(list));
  } finally {
    await browser.close().catch(() => undefined);
    child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
