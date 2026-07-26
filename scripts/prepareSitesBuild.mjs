import { access, copyFile, mkdir, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const distDirectory = path.join(projectDirectory, 'dist');
const clientDirectory = path.join(distDirectory, 'client');
const serverDirectory = path.join(distDirectory, 'server');
const workerSource = path.join(projectDirectory, 'sites', 'worker.js');
const workerTarget = path.join(serverDirectory, 'index.js');

await access(path.join(distDirectory, 'index.html'));
await access(workerSource);
await mkdir(clientDirectory, { recursive: true });

for (const entry of await readdir(distDirectory, { withFileTypes: true })) {
  if (entry.name === 'client' || entry.name === 'server') continue;
  await rename(
    path.join(distDirectory, entry.name),
    path.join(clientDirectory, entry.name),
  );
}

await mkdir(serverDirectory, { recursive: true });
await copyFile(workerSource, workerTarget);

console.log('Prepared the Sites client and worker entrypoints.');
