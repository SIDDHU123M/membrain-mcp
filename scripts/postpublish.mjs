// After `npm publish`, sync this machine's global install to the version just
// published — ends the "running 0.1.7 while 0.1.12 is live" class of confusion.
// The registry can lag a few seconds behind publish, so retry briefly.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const { name, version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const spec = `${name}@${version}`;

// mirrors have taken 3-4 minutes to sync; keep trying for ~5
const TRIES = 20;
for (let attempt = 1; attempt <= TRIES; attempt++) {
  try {
    execSync(`npm install -g ${spec}`, { stdio: attempt === 1 ? 'inherit' : 'pipe' });
    console.log(`postpublish: global ${spec} installed`);
    process.exit(0);
  } catch {
    if (attempt < TRIES) {
      console.log(`postpublish: registry not ready yet, retrying (${attempt}/${TRIES})...`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
}
console.error(`postpublish: could not reinstall globally — run: npm i -g ${spec}`);
