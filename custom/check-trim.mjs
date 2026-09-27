/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// custom/check-trim.mjs
//
// Static safety check for custom/trim.jsonc. Run it after every change to the trim list and
// after every upstream sync:
//
//   node custom/check-trim.mjs
//
// Why this exists: commenting out a side-effect import looks harmless, but a contribution
// module usually registers DI services as well as UI. If a service it registers is no longer
// registered anywhere, every reachable file that injects it fails at runtime with
//
//   [createInstance] X depends on Y which is NOT registered
//
// which is exactly what happened the first time this fork was launched (IMcpService, 64
// errors). This script predicts those failures without needing a build.
//
// Model
//   * Commenting out an entry import removes only one edge. If the module is still reachable
//     through another live import, the trim is INEFFECTIVE - nothing is lost, nothing changes.
//   * Otherwise the services it registered are gone. A reachable file still referencing such a
//     service is reported as a problem. Static analysis cannot tell eager (constructor)
//     injection from lazy injection, so UNSAFE means "must be verified", and the runtime log
//     remains the authority on what actually breaks.
//   * A module that other code imports a *value* from can never be trimmed this way.

import fs from 'node:fs';
import path from 'node:path';
import { isMainModule, loadTrimConfig, ROOT } from './lib/trim-core.mjs';

const SRC_ROOT = path.join(ROOT, 'src', 'vs');
const ROOTS = ['src/vs/workbench/workbench.desktop.main.ts'];

const importRe = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
const liveImports = text => text.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const rel = f => path.relative(ROOT, f).replaceAll('\\', '/');

function resolveModule(fromFile, spec) {
	if (!spec.startsWith('.')) { return null; }
	const abs = path.resolve(path.dirname(fromFile), spec).replaceAll('\\', '/');
	return abs.endsWith('.css') ? null : abs.replace(/\.js$/, '.ts');
}

export function run() {
	const config = loadTrimConfig();

	// trimmed modules, and which entry file each was trimmed from
	const trimmedFrom = new Map();
	for (const [entryFile, specifiers] of Object.entries(config.commentImports ?? {})) {
		const entryDir = path.dirname(path.join(ROOT, entryFile));
		for (const specifier of specifiers) {
			const abs = path.resolve(entryDir, specifier).replaceAll('\\', '/').replace(/\.js$/, '.ts');
			if (!trimmedFrom.has(abs)) { trimmedFrom.set(abs, new Set()); }
			trimmedFrom.get(abs).add(entryFile);
		}
	}

	// reachability from the workbench entry point, over live (non-commented) imports
	const reachable = new Set();
	const queue = ROOTS.map(r => path.join(ROOT, r).replaceAll('\\', '/'));
	while (queue.length) {
		const file = queue.pop();
		if (reachable.has(file)) { continue; }
		let text;
		try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
		reachable.add(file);
		let m;
		importRe.lastIndex = 0;
		while ((m = importRe.exec(liveImports(text)))) {
			const next = resolveModule(file, m[1]);
			if (next && !reachable.has(next)) { queue.push(next); }
		}
	}
	const reachableList = [...reachable];

	const textCache = new Map();
	const textOf = f => {
		if (!textCache.has(f)) {
			try { textCache.set(f, fs.readFileSync(f, 'utf8')); } catch { textCache.set(f, ''); }
		}
		return textCache.get(f);
	};

	const regRe = /registerSingleton\(\s*([A-Za-z_$][\w$]*)/g;
	const stillRegistered = iface => {
		const re = new RegExp(`registerSingleton\\(\\s*${iface}\\b`);
		return reachableList.some(f => re.test(textOf(f)));
	};
	const reachableReferrers = iface => {
		const re = new RegExp(`\\b${iface}\\b`);
		return reachableList
			.filter(f => !rel(f).includes('/test/'))
			.filter(f => re.test(textOf(f)))
			.map(rel);
	};

	const safe = [], unsafe = [], ineffective = [];
	for (const [abs, entries] of trimmedFrom) {
		if (reachable.has(abs)) { ineffective.push(abs); continue; }
		const lost = [];
		for (const m of textOf(abs).matchAll(regRe)) {
			if (stillRegistered(m[1])) { continue; }
			const refs = reachableReferrers(m[1]);
			if (refs.length > 0) { lost.push({ iface: m[1], refs }); }
		}
		(lost.length === 0 ? safe : unsafe).push({ abs, lost });
	}

	console.log(`reachable modules : ${reachableList.length}`);
	console.log(`trimmed modules   : ${trimmedFrom.size}`);

	if (ineffective.length) {
		console.log(`\nINEFFECTIVE (${ineffective.length}) - still reachable via another live import:`);
		for (const f of ineffective) { console.log(`  ${rel(f)}`); }
	}

	if (unsafe.length) {
		console.log(`\nUNSAFE (${unsafe.length}) - a reachable file would inject a service that is gone:`);
		for (const u of unsafe) {
			console.log(`  ${rel(u.abs)}`);
			for (const { iface, refs } of u.lost) {
				console.log(`      ${iface}  (${refs.length} reachable referrer(s), e.g. ${refs[0]})`);
			}
		}
	}

	console.log(`\nsafe: ${safe.length}`);
	if (unsafe.length || ineffective.length) {
		console.error(`\n${unsafe.length + ineffective.length} problem(s). Fix custom/trim.jsonc before shipping.`);
		return 1;
	}
	console.log('all trims verified safe.');
	return 0;
}

if (isMainModule(import.meta.filename)) {
	process.exit(run());
}
