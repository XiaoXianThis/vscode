/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// custom/apply-trim.mjs
//
// Re-applies custom/trim.jsonc to the upstream files this fork derives from it.
//
// The workbench aggregation entry files (workbench.common.main.ts, workbench.desktop.main.ts,
// workbench.web.main.ts, ...) are the one place where VS Code decides which feature
// contributions exist. Build entry point lists and the built-in extension list are the
// equivalents for the build. We never hand-edit any of them. Instead this script takes
// whatever version of the file is on disk - in practice the freshly merged upstream
// version - and applies the declarative edits from trim.jsonc.
//
// Two properties follow:
//   * upstream additions are always preserved (we start from upstream's content),
//   * our removals are always re-applied (we re-run the list every time),
// so merging from upstream never conflicts in these files.
//
// Usage:
//   node custom/apply-trim.mjs              apply, write files
//   node custom/apply-trim.mjs --check      exit 1 if any trim is missing, or if a stale
//                                           trim is left behind
//   node custom/apply-trim.mjs --restore    revert every trim, listed or not
//   node custom/apply-trim.mjs --list       print the trim list and exit

import fs from 'node:fs';
import path from 'node:path';
import { applyFileTrims, findOrphanTrims, isMainModule, loadTrimConfig, ownedFiles, ROOT, sweepRestore } from './lib/trim-core.mjs';

export function run(argv = process.argv.slice(2)) {
	const check = argv.includes('--check');
	const restore = argv.includes('--restore');
	const list = argv.includes('--list');

	const config = loadTrimConfig();

	if (list) {
		for (const [file, specifiers] of Object.entries(config.commentImports ?? {})) {
			console.log(`${file}  (comment imports)`);
			for (const specifier of specifiers) { console.log(`  - ${specifier}`); }
		}
		for (const [file, lines] of Object.entries(config.commentLines ?? {})) {
			console.log(`${file}  (comment lines)`);
			for (const line of lines) { console.log(`  - ${line}`); }
		}
		for (const { file, find, replace } of config.replacements ?? []) {
			console.log(`${file}  (replace)`);
			console.log(`  - ${JSON.stringify(find)}`);
			console.log(`    -> ${JSON.stringify(replace)}`);
		}
		return 0;
	}

	let failures = 0;
	let changed = 0;

	for (const relFile of ownedFiles(config)) {
		const file = path.join(ROOT, relFile);
		if (!fs.existsSync(file)) {
			console.error(`[trim] MISSING FILE ${relFile}`);
			failures++;
			continue;
		}

		const original = fs.readFileSync(file, 'utf8');
		let text;

		if (restore) {
			// Blind sweep: revert everything we ever marked, including entries that have
			// since been removed from trim.jsonc.
			text = sweepRestore(original).text;
		} else {
			const applied = applyFileTrims(original, relFile, config, 'apply');
			text = applied.text;
			for (const entry of applied.report) {
				if (entry.kind === 'missing') {
					console.error(`[trim] NOT FOUND in ${relFile}: ${entry.subject}`);
					console.error('[trim]   -> upstream moved or renamed it. Update custom/trim.jsonc.');
					failures++;
				} else if (entry.kind === 'already-commented') {
					console.log(`[trim] already commented upstream in ${relFile}: ${entry.subject}`);
				}
			}

			// A marker with no matching entry means the entry was deleted from trim.jsonc
			// without reverting the file. That silently keeps a feature trimmed, so it is a
			// hard failure rather than a warning.
			for (const orphan of findOrphanTrims(text, relFile, config)) {
				console.error(`[trim] STALE TRIM in ${relFile}: ${orphan}`);
				console.error('[trim]   -> not in custom/trim.jsonc anymore. Run: node custom/apply-trim.mjs --restore');
				failures++;
			}
		}

		if (text !== original) {
			if (check) {
				console.error(`[trim] NOT APPLIED in ${relFile} (run: node custom/apply-trim.mjs)`);
				failures++;
			} else {
				fs.writeFileSync(file, text);
				changed++;
				console.log(`[trim] ${restore ? 'restored' : 'applied'} ${relFile}`);
			}
		}
	}

	if (failures > 0) {
		console.error(`[trim] ${failures} problem(s).`);
		return 1;
	}
	console.log(`[trim] ok (${changed} file(s) ${restore ? 'restored' : 'updated'}).`);
	return 0;
}

if (isMainModule(import.meta.filename)) {
	process.exit(run());
}
