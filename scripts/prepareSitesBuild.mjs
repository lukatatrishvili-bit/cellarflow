import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const distDirectory = path.join(projectDirectory, 'dist');
const serverDirectory = path.join(distDirectory, 'server');
const workerSource = path.join(projectDirectory, 'sites', 'worker.js');
const workerTarget = path.join(serverDirectory, 'index.js');

await access(path.join(distDirectory, 'index.html'));
await access(workerSource);
await mkdir(serverDirectory, { recursive: true });
await copyFile(workerSource, workerTarget);

console.log('Prepared the Sites worker entrypoint.');
