// npm renders no mermaid, GitHub does — ship scripts/README.npm.md in the tarball,
// keep the diagram-rich README.md for the repo. Runs via prepack/postpack.
import fs from 'node:fs';

const mode = process.argv[2];
if (mode === 'npm') {
  fs.copyFileSync('README.md', '.readme-github.bak');
  fs.copyFileSync('scripts/README.npm.md', 'README.md');
} else if (mode === 'restore') {
  if (fs.existsSync('.readme-github.bak')) {
    fs.copyFileSync('.readme-github.bak', 'README.md');
    fs.rmSync('.readme-github.bak');
  }
} else {
  console.error('usage: swap-readme.mjs npm|restore');
  process.exit(1);
}
