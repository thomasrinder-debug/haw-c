// Lädt das w64devkit nach kit/ und prüft die Prüfsumme. Das Kit liegt nicht im Git.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION = '2.11.0';
const SHA256 = '54c2bb9962e8a30c8270e34c5efc3d5fee579f53087fa7d435b95fbba2af7b2b';
const NAME = `w64devkit-x64-${VERSION}.7z.exe`;
const URL = `https://github.com/skeeto/w64devkit/releases/download/v${VERSION}/${NAME}`;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const dir = path.join(__dirname, '..', 'kit');
  const file = path.join(dir, NAME);
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === SHA256) {
    console.log(`${NAME} ist vorhanden.`);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  console.log(`Lade ${URL}`);
  const response = await fetch(URL);
  if (!response.ok) {
    throw new Error(`Download fehlgeschlagen: ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== SHA256) {
    throw new Error('Prüfsumme stimmt nicht.');
  }
  fs.writeFileSync(file, data);
  console.log(`${NAME} geladen.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
