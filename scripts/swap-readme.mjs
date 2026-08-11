// npm renders no mermaid, GitHub does — ship docs/README.npm.md in the tarball,
// keep the diagram-rich README.md for the repo. Runs via prepack/postpack.
import fs from 'node:fs';

const mode = process.argv[2];
if (mode === 'npm') {
  fs.copyFileSync('README.md', 'README.github.md.bak');
  fs.copyFileSync('docs/README.npm.md', 'README.md');
} else if (mode === 'restore') {
  if (fs.existsSync('README.github.md.bak')) {
    fs.copyFileSync('README.github.md.bak', 'README.md');
    fs.rmSync('README.github.md.bak');
  }
} else {
  console.error('usage: swap-readme.mjs npm|restore');
  process.exit(1);
}
