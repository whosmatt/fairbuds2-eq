#!/usr/bin/env node
// Writes presets/community/<slug>.txt from a preset issue form. Usage: issue-preset.mjs <event.json>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { issue } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const field = {};
for (const [, key, value] of (issue.body || '').matchAll(/^### (.+)\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)) {
  const v = value.trim();
  field[key.trim().toLowerCase()] = v === '_No response_' ? '' : v;
}

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const name = oneLine(field.name || '');
const eq = (field.eq || '').replace(/^```\w*\n?|\n?```$/g, '').trim();
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (!slug || !eq) throw new Error('issue has no name or no EQ');

const dir = new URL('../presets/community/', import.meta.url).pathname;
const file = join(dir, `${slug}.txt`);
if (existsSync(file)) throw new Error(`presets/community/${slug}.txt already exists`);
mkdirSync(dir, { recursive: true });
const header = [`# Name: ${name}`, `# Author: ${oneLine(field.author || issue.user.login)}`];
if (field.description) header.push(`# Description: ${oneLine(field.description)}`);
writeFileSync(file, `${header.join('\n')}\n${eq.split('\n').filter((l) => !l.startsWith('#')).join('\n')}\n`);
console.log(`name=${name}`);
