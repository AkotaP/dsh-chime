/**
 * Link-install dsh-chime into a DSH profile for development.
 *
 *   node tools/link-install.mjs [profile]     # profile defaults to `web`
 *
 * Deliberately does **not** re-serialize the profile's package.json: it backs
 * the file up first, then splices two entries with literal text replacement so
 * the hand-maintained formatting and key order survive untouched. The insertion
 * point is derived from the block's own last line, so it works for any profile
 * regardless of which dependencies/bundles happen to be last.
 */
import fs from 'node:fs';
import path from 'node:path';

const PROFILE_NAME = process.argv[2] ?? 'web';
const PROFILE = `C:/Users/timat/.dsh/profiles/${PROFILE_NAME}`;
const REPO = 'E:/Data/Project/dsh/dsh-chime';
const NAME = 'dsh-chime';

const pkgPath = path.join(PROFILE, 'package.json');
if (!fs.existsSync(pkgPath)) {
  throw new Error(`profile package.json not found: ${pkgPath}`);
}

const original = fs.readFileSync(pkgPath, 'utf8');
if (original.includes(`"${NAME}"`)) {
  console.log(`[link-install] "${NAME}" already present in ${pkgPath}; nothing to do.`);
  process.exit(0);
}

const eol = original.includes('\r\n') ? '\r\n' : '\n';

/**
 * Splice one entry into a JSON object/array literal, preserving formatting.
 *
 * Locates the block that follows `key`, finds its last non-blank line, appends
 * a comma when missing, and inserts the new entry at the same indentation.
 *
 * @param {string} text - whole file text.
 * @param {string} key - quoted key whose block receives the entry.
 * @param {string} entryText - entry body without indentation, e.g. `"a": "b"`.
 * @returns {string} the updated text.
 */
function appendEntry(text, key, entryText) {
  const keyAt = text.indexOf(key);
  if (keyAt < 0) throw new Error(`anchor key not found: ${key}`);

  const isObject = key === '"dependencies"';
  const openAt = text.indexOf(isObject ? '{' : '[', keyAt);
  const closeAt = text.indexOf(isObject ? '}' : ']', openAt);
  if (openAt < 0 || closeAt < 0) throw new Error(`block not found for ${key}`);

  const lines = text.slice(openAt + 1, closeAt).split(eol);
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() !== '') {
      last = i;
      break;
    }
  }
  if (last < 0) throw new Error(`empty block for ${key}`);

  const line = lines[last];
  const indent = line.slice(0, line.length - line.trimStart().length);
  if (!line.trimEnd().endsWith(',')) lines[last] = `${line},`;
  lines.splice(last + 1, 0, `${indent}${entryText}`);

  return text.slice(0, openAt + 1) + lines.join(eol) + text.slice(closeAt);
}

const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
const backup = `${pkgPath}.bak-add-${NAME}-${stamp}`;
fs.writeFileSync(backup, original);
console.log(`[link-install] backup -> ${backup}`);

let next = appendEntry(original, '"dependencies"', `"${NAME}": "link:${REPO}"`);
next = appendEntry(next, '"bundles"', `"${NAME}"`);

// Parse before writing: a broken profile package.json would break boot.
const parsed = JSON.parse(next);
if (parsed.dependencies[NAME] !== `link:${REPO}`) throw new Error('dependency edit did not land');
if (!parsed.dsh.profile.bundles.includes(NAME)) throw new Error('bundle edit did not land');

fs.writeFileSync(pkgPath, next);
console.log(`[link-install] patched ${PROFILE_NAME} profile: ${pkgPath}`);
console.log(`[link-install]   dependencies.${NAME} = ${parsed.dependencies[NAME]}`);
console.log(`[link-install]   bundles = ${parsed.dsh.profile.bundles.join(', ')}`);
