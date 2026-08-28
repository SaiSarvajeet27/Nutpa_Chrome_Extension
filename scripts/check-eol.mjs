#!/usr/bin/env node
/**
 * Fail if any tracked source file contains a CR.
 *
 * Why this exists: `extension/content.js` is a COMMITTED build artifact. The
 * bundler embeds source text verbatim — including the line endings inside
 * multi-line className strings — so building from a CRLF working tree produces
 * a different bundle than building from the LF content the repo actually
 * stores. The committed artifact then cannot be reproduced from a clean clone,
 * which is exactly the kind of drift that makes a checked-in build untrustworthy.
 *
 * This bit twice. `.gitattributes` alone was not enough: it normalizes what git
 * STORES, while `core.autocrlf=true` and editors/scripts that write CRLF still
 * leave the working tree with CR — and the build reads the working tree.
 *
 * Fix when this fails:  node scripts/check-eol.mjs --fix
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|html|yml|yaml)$/;
const SKIP = [/^extension\/libs\//]; // vendored Whisper runtime — not ours

const fix = process.argv.includes('--fix');

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && TEXT.test(f) && !SKIP.some((re) => re.test(f)));

const offenders = [];
for (const f of files) {
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    continue; // listed but absent (e.g. mid-rebase) — not this check's problem
  }
  if (!buf.includes(13)) continue;
  offenders.push(f);
  if (fix) writeFileSync(f, buf.toString('utf8').replace(/\r\n/g, '\n'), { encoding: 'utf8' });
}

if (!offenders.length) {
  console.log(`line endings: ${files.length} tracked text files, all LF`);
  process.exit(0);
}

if (fix) {
  console.log(`line endings: converted ${offenders.length} file(s) to LF`);
  console.log('Rebuild before committing:  npm run build:ext');
  process.exit(0);
}

console.error(`\nCRLF found in ${offenders.length} tracked file(s):\n`);
for (const f of offenders.slice(0, 15)) console.error('  ' + f);
if (offenders.length > 15) console.error(`  …and ${offenders.length - 15} more`);
console.error(
  '\nThe committed extension/content.js is built from these files, so CRLF here\n' +
    'means the bundle will not reproduce from a clean clone.\n\n' +
    'Fix:  node scripts/check-eol.mjs --fix && npm run build:ext\n'
);
process.exit(1);
