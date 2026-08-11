// After `npm publish`, sync this machine's global install to the version just
// published — ends the "running 0.1.7 while 0.1.12 is live" class of confusion.
// The registry can lag a few seconds behind publish, so retry briefly.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const { name, version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const spec = `${name}@${version}`;

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    execSync(`npm install -g ${spec}`, { stdio: 'inherit' });
    console.log(`postpublish: global ${spec} installed`);
    process.exit(0);
  } catch {
    if (attempt < 3) {
      console.log(`postpublish: registry not ready yet, retrying (${attempt}/3)...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
console.error(`postpublish: could not reinstall globally — run: npm i -g ${spec}`);
