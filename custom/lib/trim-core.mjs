/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// custom/lib/trim-core.mjs
//
// Shared, side-effect free helpers for the trim tooling. Kept dependency-free so the
// scripts can run immediately after a merge, before `npm install`.
//
// trim.jsonc supports three declarative edit kinds, all of which are idempotent and
// reversible, and all of which are re-derived from upstream content on every merge:
//
//   commentImports  { "<file>": ["<module specifier>", ...] }
//       Comments out `import '<specifier>';` lines. Use for aggregation entry files.
//
//   commentLines    { "<file>": ["<exact trimmed line>", ...] }
//       Comments out an exact line. Use for array elements (build entry points,
//       extension exclusion lists, gulp task lists).
//
//   replacements    [{ "file": "<file>", "find": "<text>", "replace": "<text>" }]
//       Literal substring replacement. Use where commenting out is not valid, e.g.
//       package.json scripts.
//
//   addLines        { "<file>": ["<line>", ...] }
//       Appends our own lines (typically a side-effect import of a fork-owned module) at the
//       end of an upstream file, under a marker comment. This is the counterpart to
//       commentImports: the entry files are the only place a fork can register its own
//       workbench contribution, and hand-editing them would be undone by the merge driver.
//
//   addBlocks       { "<file>": ["<path under custom/>", ...] }
//       Injects a whole document block, read from a file under custom/, into an upstream
//       markdown file between HTML-comment markers. Used to make AGENTS.md carry this fork's
//       rules without hand-editing an upstream file.

import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const TRIM_FILE = path.join(ROOT, 'custom', 'trim.jsonc');
export const TRIM_PREFIX = '// [trim] ';
export const TRIM_ADD_MARKER = '// [trim-add] ';

/**
 * Minimal JSONC comment stripper, so trim.jsonc can carry comments without a dependency.
 * @param {string} text
 * @returns {string}
 */
export function stripJsonComments(text) {
	let out = '';
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		const next = text[i + 1];
		if (inLineComment) {
			if (c === '\n') { inLineComment = false; out += c; }
			continue;
		}
		if (inBlockComment) {
			if (c === '*' && next === '/') { inBlockComment = false; i++; }
			continue;
		}
		if (inString) {
			out += c;
			if (c === '\\') { out += next; i++; }
			else if (c === '"') { inString = false; }
			continue;
		}
		if (c === '"') { inString = true; out += c; continue; }
		if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
		if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
		out += c;
	}
	return out;
}

/**
 * @typedef {{ commentImports?: Record<string, string[]>, commentLines?: Record<string, string[]>,
 *             replacements?: Array<{ file: string, find: string, replace: string }>,
 *             addLines?: Record<string, string[]>,
 *             addBlocks?: Record<string, string[]> }} TrimConfig
 */

/** @returns {TrimConfig} */
export function loadTrimConfig() {
	return JSON.parse(stripJsonComments(fs.readFileSync(TRIM_FILE, 'utf8')));
}

/** All repo-relative files that any trim kind touches. @param {TrimConfig} config */
export function ownedFiles(config) {
	return new Set([
		...Object.keys(config.commentImports ?? {}),
		...Object.keys(config.commentLines ?? {}),
		...Object.keys(config.addLines ?? {}),
		...Object.keys(config.addBlocks ?? {}),
		...(config.replacements ?? []).map(r => r.file),
	]);
}

const BLOCK_BEGIN = /<!-- custom:begin ([^>]+?) -->/;
const blockBegin = id => `<!-- custom:begin ${id} -->`;
const blockEnd = id => `<!-- custom:end ${id} -->`;

/**
 * Resolve the document blocks configured for a file, reading their content from custom/.
 * @param {string} relFile @param {TrimConfig} config
 * @returns {Array<{ id: string, content: string }>}
 */
export function addBlocksFor(relFile, config) {
	return (config.addBlocks?.[relFile] ?? []).map(spec => {
		const id = spec.replace(/^\.\//, '');
		const source = path.resolve(ROOT, 'custom', spec);
		return { id, content: fs.readFileSync(source, 'utf8').trimEnd() };
	});
}

/**
 * Insert / refresh marker-delimited document blocks at the end of a file.
 *
 * The marked region is generated output: edit the source file under custom/, not the target.
 * Because apply rewrites the region from the source every time, a direct edit inside the
 * region shows up as "NOT APPLIED" in `--check` rather than being silently lost.
 *
 * @param {string} text @param {Array<{ id: string, content: string }>} blocks
 * @param {'apply'|'restore'} mode
 */
export function applyAddBlocks(text, blocks, mode) {
	const report = [];
	let out = text;

	for (const { id, content } of blocks) {
		const begin = blockBegin(id);
		const end = blockEnd(id);
		const bi = out.indexOf(begin);
		const ei = out.indexOf(end);

		if (mode === 'restore') {
			if (bi === -1) { report.push({ subject: id, kind: 'missing' }); continue; }
			out = out.slice(0, bi).replace(/\s+$/, '') + '\n';
			report.push({ subject: id, kind: 'trimmed' });
			continue;
		}

		if (bi !== -1 && ei !== -1) {
			const region = `${begin}\n${content}\n${end}`;
			const replaced = out.slice(0, bi) + region + out.slice(ei + end.length);
			report.push({ subject: id, kind: replaced === out ? 'trimmed' : 'active' });
			out = replaced;
		} else if (bi === -1 && ei === -1) {
			out = out.replace(/\s+$/, '') + `\n\n${begin}\n${content}\n${end}\n`;
			report.push({ subject: id, kind: 'active' });
		} else {
			// A half-present marker means the region was hand-edited; refuse to guess.
			report.push({ subject: id, kind: 'missing' });
		}
	}

	return { text: out, report };
}

function splitLines(text) {
	// Preserve the file's line endings: a Windows checkout with core.autocrlf=true hands
	// us CRLF, and mixing endings would show up as a whole-file diff.
	return { lines: text.split(/\r?\n/), eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

/**
 * Comment out / restore `import '<specifier>';` lines.
 * @param {string} text @param {string[]} specifiers @param {'apply'|'restore'} mode
 */
export function applyCommentImports(text, specifiers, mode) {
	const { lines, eol } = splitLines(text);
	const report = [];
	for (const specifier of specifiers) {
		let found = 'missing';
		for (let i = 0; i < lines.length; i++) {
			const t = lines[i].trim();
			if (t === `import '${specifier}';` || t === `import "${specifier}";`) {
				found = 'active';
				if (mode === 'apply') { lines[i] = TRIM_PREFIX + t; }
				break;
			}
			if (t === `${TRIM_PREFIX}import '${specifier}';` || t === `${TRIM_PREFIX}import "${specifier}";`) {
				found = 'trimmed';
				if (mode === 'restore') { lines[i] = t.slice(TRIM_PREFIX.length); }
				break;
			}
			if (t === `// import '${specifier}';` || t === `// import "${specifier}";`) {
				// upstream itself commented this one out (the Agents window does this a lot)
				found = 'already-commented';
				break;
			}
		}
		report.push({ subject: specifier, kind: found });
	}
	return { text: lines.join(eol), report };
}

/**
 * Comment out / restore every occurrence of an exact line.
 * (The same line can legitimately appear more than once in a file, e.g. an entry point
 * listed in both the entry point array and the CSS-bundling set.)
 * @param {string} text @param {string[]} targets @param {'apply'|'restore'} mode
 */
export function applyCommentLines(text, targets, mode) {
	const { lines, eol } = splitLines(text);
	const report = [];
	for (const target of targets) {
		let hits = 0;
		let alreadyTrimmed = 0;
		for (let i = 0; i < lines.length; i++) {
			const t = lines[i].trim();
			if (t === target) {
				hits++;
				if (mode === 'apply') { lines[i] = TRIM_PREFIX + t; }
			} else if (t === TRIM_PREFIX + target) {
				alreadyTrimmed++;
				if (mode === 'restore') { lines[i] = t.slice(TRIM_PREFIX.length); }
			}
		}
		report.push({
			subject: target,
			kind: hits > 0 ? 'active' : alreadyTrimmed > 0 ? 'trimmed' : 'missing',
		});
	}
	return { text: lines.join(eol), report };
}

/**
 * Literal substring replacement / restore.
 * @param {string} text @param {Array<{find: string, replace: string}>} reps @param {'apply'|'restore'} mode
 */
export function applyReplacements(text, reps, mode) {
	const report = [];
	let out = text;
	for (const { find, replace } of reps) {
		const from = mode === 'restore' ? replace : find;
		const to = mode === 'restore' ? find : replace;
		if (!out.includes(from)) {
			report.push({ subject: find, kind: out.includes(to) ? 'trimmed' : 'missing' });
			continue;
		}
		out = out.replaceAll(from, to);
		report.push({ subject: find, kind: 'active' });
	}
	return { text: out, report };
}

/**
 * Append / remove our own lines at the end of a file, under a marker comment.
 *
 * The marker block always runs from `// [trim-add] ...` to end of file, so it can be removed
 * wholesale - including lines that are no longer in trim.jsonc (see sweepRestore).
 *
 * @param {string} text @param {string[]} targets @param {'apply'|'restore'} mode
 */
export function applyAddLines(text, targets, mode) {
	const { lines, eol } = splitLines(text);
	const norm = l => l.trim();

	if (mode === 'restore') {
		const kept = lines.filter(l => {
			const t = norm(l);
			if (t.startsWith('// [trim-add]')) { return false; }
			return !targets.some(x => norm(x) === t);
		});
		const removed = kept.length !== lines.length;
		return {
			text: kept.join(eol),
			report: targets.map(l => ({ subject: l, kind: removed ? 'active' : 'trimmed' })),
		};
	}

	const present = new Set(lines.map(norm));
	const missing = targets.filter(l => !present.has(norm(l)));
	const report = targets.map(l => ({ subject: l, kind: present.has(norm(l)) ? 'trimmed' : 'active' }));
	if (missing.length === 0) { return { text, report }; }

	// rebuild the block from scratch so it stays in sync with trim.jsonc
	const kept = lines.filter(l => !norm(l).startsWith('// [trim-add]'));
	while (kept.length && norm(kept[kept.length - 1]) === '') { kept.pop(); }
	kept.push('', `${TRIM_ADD_MARKER}custom fork additions - maintained by custom/trim.jsonc`, ...missing, '');
	return { text: kept.join(eol), report };
}

/**
 * Apply every trim kind that targets `relFile`.
 * @param {string} text @param {string} relFile @param {TrimConfig} config @param {'apply'|'restore'} mode
 */
export function applyFileTrims(text, relFile, config, mode) {
	const report = [];
	let out = text;

	const imports = config.commentImports?.[relFile] ?? [];
	if (imports.length) {
		const r = applyCommentImports(out, imports, mode);
		out = r.text;
		report.push(...r.report);
	}

	const lines = config.commentLines?.[relFile] ?? [];
	if (lines.length) {
		const r = applyCommentLines(out, lines, mode);
		out = r.text;
		report.push(...r.report);
	}

	const reps = (config.replacements ?? []).filter(r => r.file === relFile);
	if (reps.length) {
		const r = applyReplacements(out, reps, mode);
		out = r.text;
		report.push(...r.report);
	}

	const added = config.addLines?.[relFile] ?? [];
	if (added.length) {
		const r = applyAddLines(out, added, mode);
		out = r.text;
		report.push(...r.report);
	}

	const blocks = addBlocksFor(relFile, config);
	if (blocks.length) {
		const r = applyAddBlocks(out, blocks, mode);
		out = r.text;
		report.push(...r.report);
	}

	return { text: out, report };
}

/** @returns {boolean} true when `modulePath` is the process entry point */
export function isMainModule(modulePath) {
	return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(modulePath);
}

/**
 * Un-comment *every* line this tooling ever trimmed, whether or not it is still listed in
 * trim.jsonc.
 *
 * This matters: a plain `--restore` driven by the current list cannot undo a trim whose
 * entry was since removed from trim.jsonc, which would leave the file stuck in the trimmed
 * state with no way back. Reverting is therefore a blind sweep of the marker.
 *
 * @param {string} text
 */
export function sweepRestore(text) {
	// Document blocks are appended at the end, so the whole region can be cut wholesale.
	let count = 0;
	const blockAt = text.search(BLOCK_BEGIN);
	let body = text;
	if (blockAt !== -1) {
		count += text.slice(blockAt).split('\n').length;
		body = text.slice(0, blockAt).replace(/\s+$/, '') + '\n';
	}

	const { lines, eol } = splitLines(body);
	let out = [];
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i].trim();
		if (t.startsWith(TRIM_ADD_MARKER)) {
			// the added block always runs to end of file - drop the rest, including the
			// blank line we inserted before the marker
			while (out.length && out[out.length - 1].trim() === '') { out.pop(); }
			count += lines.length - i;
			break;
		}
		if (t.startsWith(TRIM_PREFIX)) {
			const indent = lines[i].slice(0, lines[i].length - lines[i].trimStart().length);
			out.push(indent + t.slice(TRIM_PREFIX.length));
			count++;
		} else {
			out.push(lines[i]);
		}
	}
	return { text: out.join(eol), count };
}

/**
 * Lines that carry our markers but are no longer explained by trim.jsonc. These are stale
 * edits - typically because an entry was removed from the list without reverting the file.
 *
 * @param {string} text @param {string} relFile @param {TrimConfig} config
 * @returns {string[]}
 */
export function findOrphanTrims(text, relFile, config) {
	const expected = new Set();
	for (const spec of config.commentImports?.[relFile] ?? []) {
		expected.add(`import '${spec}';`);
		expected.add(`import "${spec}";`);
	}
	for (const line of config.commentLines?.[relFile] ?? []) {
		expected.add(line);
	}

	const orphans = [];

	// a document block whose source file is no longer configured
	const expectedBlockIds = new Set((config.addBlocks?.[relFile] ?? []).map(s => s.replace(/^\.\//, '')));
	for (const m of text.matchAll(/<!-- custom:begin ([^>]+?) -->/g)) {
		if (!expectedBlockIds.has(m[1])) { orphans.push(`<!-- custom:begin ${m[1]} -->`); }
	}

	let inAddedBlock = false;
	for (const line of text.split(/\r?\n/)) {
		const t = line.trim();
		if (t.startsWith(TRIM_ADD_MARKER)) { inAddedBlock = true; continue; }
		if (inAddedBlock) {
			if (t === '') { continue; }
			if (!(config.addLines?.[relFile] ?? []).some(l => l.trim() === t)) { orphans.push(t); }
			continue;
		}
		if (!t.startsWith(TRIM_PREFIX)) { continue; }
		const body = t.slice(TRIM_PREFIX.length);
		if (!expected.has(body)) { orphans.push(body); }
	}
	return orphans;
}
