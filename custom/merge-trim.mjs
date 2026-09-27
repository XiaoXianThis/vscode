/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// custom/merge-trim.mjs
//
// A git merge driver for the workbench aggregation entry files.
//
// Git invokes it as:  node custom/merge-trim.mjs %O %A %B %A
//   %O = merge base, %A = ours (also the result file), %B = theirs (upstream)
//
// Because our content in these files is *derived* (upstream's content minus trim.jsonc),
// the correct resolution is always: re-derive from whichever side is newer.
//
// IMPORTANT CAVEAT - read custom/README.md before relying on this alone.
// Git only calls a merge driver when the file changed on *both* sides. In the common
// case (we have not touched the file since the last sync, upstream has) git resolves the
// merge itself by taking upstream's version and never calls this driver - which means the
// trims would be silently dropped. That is why `custom/sync.mjs` (or a post-merge hook)
// always runs `apply-trim.mjs` after a merge. The driver is here to keep the
// both-sides-changed case free of conflict markers.

import fs from 'node:fs';
import path from 'node:path';
import { applyFileTrims, isMainModule, loadTrimConfig, ownedFiles, ROOT } from './lib/trim-core.mjs';

export function run(argv = process.argv.slice(2)) {
	const [basePath, oursPath, theirsPath, resultPath = oursPath] = argv;
	if (!basePath || !oursPath || !theirsPath) {
		console.error('[trim-merge] usage: node custom/merge-trim.mjs <base> <ours> <theirs> <result>');
		return 2;
	}

	const relFile = path.relative(ROOT, path.resolve(resultPath)).replaceAll('\\', '/');
	const config = loadTrimConfig();
	const isOwned = ownedFiles(config).has(relFile);

	// Git passes %A as a path relative to the top of the working tree. If we ever see a path
	// that escapes the repository, the driver is being invoked in a way we did not anticipate -
	// say so loudly instead of silently passing upstream through, which would look like the
	// merge succeeded while our content was dropped.
	if (relFile.startsWith('..')) {
		console.error(`[trim-merge] ${resultPath} resolves outside the repository (${relFile}).`);
		console.error('[trim-merge]   Passing upstream through unchanged - verify the merge by hand.');
	}

	const base = fs.readFileSync(basePath, 'utf8');
	const ours = fs.readFileSync(oursPath, 'utf8');
	const theirs = fs.readFileSync(theirsPath, 'utf8');

	let result;
	if (theirs === base) {
		// Upstream did not touch this file; our version already carries the trims.
		result = ours;
	} else {
		result = isOwned ? applyFileTrims(theirs, relFile, config, 'apply').text : theirs;
	}

	fs.writeFileSync(resultPath, result);

	if (result !== ours) {
		console.log(`[trim-merge] ${relFile}: re-derived from upstream (trim.jsonc re-applied).`);
		console.log('[trim-merge]   Review before committing: upstream may have changed this file.');
	}
	return 0;
}

if (isMainModule(import.meta.filename)) {
	process.exit(run());
}
