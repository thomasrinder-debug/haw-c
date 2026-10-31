// Startet ein eigenes VS Code mit neuem Profil unter einem Pfad mit Umlaut und
// Leerzeichen, so wie bei einem Studierenden „C:\Users\Müller“.
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

async function main() {
  const root = path.resolve(__dirname, '..', '..');
  const sandbox = path.join(os.tmpdir(), 'haw-c-test', 'Frau Müller');
  fs.rmSync(path.dirname(sandbox), { recursive: true, force: true });
  const workspace = path.join(sandbox, 'Übung 1');
  const userData = path.join(sandbox, 'daten');
  const extensions = path.join(sandbox, 'erweiterungen');
  fs.mkdirSync(workspace, { recursive: true });

  const executable = await downloadAndUnzipVSCode();
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable);
  const install = cp.spawnSync(
    cli,
    // Weitere Debug-Extensions wie auf einem benutzten Rechner: Sie ändern, wie VS Code den Debugger wählt.
    [
      ...cliArgs,
      `"--extensions-dir=${extensions}"`,
      `"--user-data-dir=${userData}"`,
      '--install-extension',
      'ms-vscode.cpptools',
      '--install-extension',
      'ms-vscode.cmake-tools',
      '--install-extension',
      'ms-python.debugpy',
    ],
    { encoding: 'utf8', shell: true },
  );
  console.log(install.stdout, install.stderr);

  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'suite.js'),
    launchArgs: [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, '--disable-workspace-trust'],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
