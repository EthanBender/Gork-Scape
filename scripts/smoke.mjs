#!/usr/bin/env node
// scripts/smoke.mjs — the "does it boot?" integration gate for Goblin Empire.
//
// Why this exists: 5 agents edit the same working tree with no build step. The
// #1 cause of a black-screen boot has been an IMPORT/EXPORT MISMATCH — a module
// imports `{ weaponRange }` that another lane hasn't exported yet. Browsers fail
// silently mid-scene; you only find out by staring at a blank canvas.
//
// This script statically checks every src/**/*.js for:
//   1. Syntax errors (node --check).
//   2. Named/default imports that the target module doesn't actually export.
// It needs no browser and runs in ~1s. Wire it as a merge gate:  node scripts/smoke.mjs
// Exit 0 = safe to merge; non-zero = would break boot.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Collect the export NAMES a file provides (best-effort static scan).
function exportsOf(src) {
  const names = new Set();
  let m;
  const reDecl = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g;
  while ((m = reDecl.exec(src))) names.add(m[1]);
  // export { a, b as c }
  const reList = /export\s*\{([^}]*)\}/g;
  while ((m = reList.exec(src))) {
    for (const part of m[1].split(',')) {
      const t = part.trim(); if (!t) continue;
      const as = t.split(/\s+as\s+/); names.add((as[1] || as[0]).trim());
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  // export * from './x'  -> mark wildcard so consumers of THIS file are lenient
  const wild = [];
  const reStar = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = reStar.exec(src))) wild.push(m[1]);
  return { names, wild };
}

// Collect { targetSpec, names[] } for each relative import in a file.
function importsOf(src) {
  const imports = [];
  let m;
  const re = /import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+[A-Za-z0-9_$]+)?\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = re.exec(src))) {
    const [, def, named, spec] = m;
    if (!spec.startsWith('.')) continue; // only local files
    const names = [];
    if (def) names.push('default');
    if (named) for (const part of named.split(',')) {
      const t = part.trim(); if (!t) continue;
      names.push(t.split(/\s+as\s+/)[0].trim()); // imported (source) name
    }
    imports.push({ spec, names });
  }
  return imports;
}

const files = walk(SRC);
const exp = new Map();           // absPath -> {names, wild}
for (const f of files) exp.set(f, exportsOf(readFileSync(f, 'utf8')));

const errors = [];

// 1) syntax
for (const f of files) {
  try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); }
  catch (e) { errors.push(`SYNTAX  ${relative(ROOT, f)}\n        ${String(e.stderr || e).split('\n')[0]}`); }
}

// resolve a relative spec from an importer to an absolute file path
function resolveSpec(fromFile, spec) {
  let p = resolve(dirname(fromFile), spec);
  if (!p.endsWith('.js')) p += '.js';
  return p;
}

// gather transitively-available names for a file (following export *)
function availableNames(absPath, seen = new Set()) {
  if (seen.has(absPath)) return new Set();
  seen.add(absPath);
  const rec = exp.get(absPath);
  if (!rec) return null;                 // target not found / not a src file
  const all = new Set(rec.names);
  for (const w of rec.wild) {
    const wp = resolveSpec(absPath, w);
    const more = availableNames(wp, seen);
    if (more) for (const n of more) all.add(n);
    else all.add('*');                   // unresolved wildcard -> be lenient
  }
  return all;
}

// 2) import/export consistency
for (const f of files) {
  for (const { spec, names } of importsOf(readFileSync(f, 'utf8'))) {
    const target = resolveSpec(f, spec);
    if (!exp.has(target)) continue;       // external/generated; skip
    const have = availableNames(target);
    if (!have || have.has('*')) continue; // lenient on wildcards
    for (const n of names) {
      if (!have.has(n)) {
        errors.push(`IMPORT  ${relative(ROOT, f)}\n        imports { ${n} } from '${spec}' — not exported by ${relative(ROOT, target)}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`\n❌ smoke check FAILED — ${errors.length} issue(s) that would break boot:\n`);
  for (const e of errors) console.error('  ' + e + '\n');
  process.exit(1);
}
console.log(`✅ smoke check passed — ${files.length} modules, syntax + import/export consistent.`);
