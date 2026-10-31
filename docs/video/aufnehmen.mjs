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
  return { caption, moveTo, clickAt, click, palette, openFile, goToLine };
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
      await a.caption('HAW Kiel C: C-Programme in VS Code, ohne Einrichtung', 2800);
      await a.openFile('hallo.c');
      await a.caption('Eine .c-Datei öffnen. Oben rechts erscheinen die Knöpfe.', 2600);
      await a.click(RUN);
      await a.caption('Ausführen: Das Programm wird übersetzt und läuft im Terminal.', 3800);
    },
    fehler: async () => {
      await a.goToLine(7);
      await page.keyboard.press('End');
      await a.caption('Ein Fehler im Code, hier fehlt das Semikolon …', 1500);
      await page.keyboard.press('Backspace');
      await sleep(800);
      await a.click(RUN);
      await a.caption('… steht direkt im Code und im Problemfenster, mit deutschem Hinweis.', 4200);
      await a.goToLine(7);
      await page.keyboard.press('End');
      await page.keyboard.type(';');
      await sleep(400);
    },
    debuggen: async () => {
      await a.goToLine(7);
      await page.keyboard.press('F9');
      await a.caption('Haltepunkt setzen, dann Debuggen mit F5.', 2200);
      await page.keyboard.press('F5');
      await page.waitForSelector('.debug-toolbar', { timeout: 40000 }).catch(() => undefined);
      await a.caption('Das Programm hält an der Zeile an.', 1800);
      await a.click('.debug-pane .monaco-list-row[aria-label*="Locals"]');
      await a.caption('Links stehen die Variablen mit ihren Werten.', 3200);
      await page.keyboard.press('F5');
      await sleep(900);
      await a.caption('Weiter mit F5: Die Werte ändern sich.', 3200);
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
      await a.caption('Mehrere .c-Dateien und eigene Header gehen ohne Makefile.', 2800);
      await a.click(RUN);
      await a.caption('Es läuft: main.c und rechnen.c werden gemeinsam übersetzt.', 2600);
      await a.moveTo(90, 700);
      await a.caption('Unten links steht, wie viele Dateien zum Programm gehören.', 2800);
    },
    speicher: async () => {
      await closeAll();
      await a.openFile('feld.c');
      await a.caption('Die Speicherprüfung läuft immer mit.', 2200);
      await a.click(RUN);
      await a.caption('Am Ende meldet sie das Speicherleck mit der Zeile.', 4200);
    },
    aufgabe: async () => {
      await closeAll();
      await a.openFile('4_Aufgabe/main.c');
      await a.caption('Aufgaben mit Selbsttest: Eine aufgabe.json enthält die Testfälle.', 2800);
      await a.click(CHECK);
      await a.caption('Aufgabe prüfen zeigt, welche Tests bestehen …', 2600, true);
      await a.caption('… und bei Fehlern Eingabe, Erwartung und tatsächliche Ausgabe.', 4600, true);
    },
    schritte: async () => {
      await closeAll();
      await a.openFile('hallo.c');
      await a.caption('Das Menü HAW Kiel C steht unten links.', 2000);
      await a.click(STATUS);
      await sleep(700);
      await page.keyboard.type('Übersetzungsschritte', { delay: 30 });
      await a.caption('Übersetzungsschritte zeigen, was gcc einzeln tut.', 1600);
      await page.keyboard.press('Enter');
      await a.caption('Präprozessor, Compiler, Assembler und Linker, mit den Zwischendateien.', 4200);
      await a.caption('Installation und Hilfe: github.com/thomasrinder-debug/haw-c', 3600);
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
  const result = spawnSync(
    ffmpeg.path,
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat, '-vf', scale, '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-movflags', '+faststart', out],
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
