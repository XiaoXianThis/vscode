/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// custom/sync.mjs
//
// One command for the periodic upstream sync. Run it from the `custom/main` branch:
//
//   node custom/sync.mjs
//
// What it does:
//   1. git fetch upstream
//   2. git merge --no-edit upstream/main
//   3. resolves the derived aggregation files (workbench.*.main.ts) by taking upstream's
//      version and re-applying custom/trim.jsonc, so they never need manual conflict work
//   4. stages and commits the result
//
// If a conflict appears in a file we do NOT own, the script stops and leaves the merge in
// place so you can resolve it by hand.
//
// Options:
//   --dry-run        only fetch and report what would be merged
//   --no-commit      do not commit the re-applied trims
//   --upstream <ref> use a different upstream ref (default: upstream/main)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule, loadTrimConfig, ownedFiles, ROOT } from './lib/trim-core.mjs';
import { run as runApplyTrim } from './apply-trim.mjs';

const GIT = process.platform === 'win32' ? 'git.exe' : 'git';

function git(args, options = {}) {
	return execFileSync(GIT, args, { cwd: ROOT, encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit', ...options });
}

function gitOut(args) {
	return execFileSync(GIT, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function tryGitOut(args) {
	try {
		return gitOut(args);
	} catch {
		return '';
	}
}

function main(argv = process.argv.slice(2)) {
	const dryRun = argv.includes('--dry-run');
	const noCommit = argv.includes('--no-commit');
	const upstreamIndex = argv.indexOf('--upstream');
	const upstreamRef = upstreamIndex >= 0 ? argv[upstreamIndex + 1] : 'upstream/main';

	const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
	if (branch === 'main' || branch === 'master') {
		console.error(`[sync] refusing to sync on '${branch}'. Switch to the custom branch first:`);
		console.error('[sync]   git switch custom/main');
		return 1;
	}

	console.log(`[sync] branch: ${branch}`);
	console.log(`[sync] fetching upstream ...`);
	// Explicit refspec: the default `+refs/heads/*:refs/remotes/upstream/*` pulls every
	// one of upstream's thousands of branches. We only ever need main.
	git(['fetch', 'upstream', '+refs/heads/main:refs/remotes/upstream/main', '--no-tags']);

	const behind = tryGitOut(['rev-list', '--count', `HEAD..${upstreamRef}`]);
	const ahead = tryGitOut(['rev-list', '--count', `${upstreamRef}..HEAD`]);
	console.log(`[sync] ${behind} commit(s) behind, ${ahead} ahead of ${upstreamRef}`);
	if (behind === '0') {
		console.log('[sync] already up to date.');
		return 0;
	}

	if (dryRun) {
		console.log(`[sync] --dry-run, stopping before merge. New upstream commits:`);
		console.log(gitOut(['log', '--oneline', `HEAD..${upstreamRef}`]));
		return 0;
	}

	const owned = ownedFiles(loadTrimConfig());

	let mergeFailed = false;
	try {
		git(['merge', '--no-edit', upstreamRef]);
	} catch {
		mergeFailed = true;
	}

	if (mergeFailed) {
		const conflicted = tryGitOut(['diff', '--name-only', '--diff-filter=U'])
			.split('\n').map(l => l.trim()).filter(Boolean);
		const foreign = conflicted.filter(f => !owned.has(f));

		if (foreign.length > 0) {
			console.error('[sync] merge left conflicts in files this fork does not own:');
			for (const f of foreign) {
				console.error(`[sync]   - ${f}`);
			}
			console.error('[sync] resolve those by hand, then re-run: node custom/apply-trim.mjs');
			return 1;
		}

		for (const f of conflicted) {
			// Derived file: upstream's version is authoritative, trim.jsonc is re-applied below.
			git(['checkout', '--theirs', '--', f]);
			git(['add', '--', f]);
			console.log(`[sync] took upstream version of ${f} (trim re-applied below)`);
		}
	}

	// Always re-apply, because git resolves "only upstream changed" itself and would
	// otherwise drop the trims without ever calling the merge driver.
	const trimExit = runApplyTrim([]);
	if (trimExit !== 0) {
		console.error('[sync] apply-trim reported problems. Fix custom/trim.jsonc, then re-run.');
		return trimExit;
	}

	const ownedList = [...owned];
	const dirty = tryGitOut(['status', '--porcelain', '--', ...ownedList, 'custom']);
	if (!dirty) {
		console.log('[sync] nothing to commit.');
	} else if (noCommit) {
		console.log('[sync] trims re-applied but left uncommitted (--no-commit).');
	} else {
		git(['add', '--', ...ownedList, 'custom']);
		git(['commit', '--no-edit', '-m', `custom: re-apply trim after upstream sync (${upstreamRef})`]);
		console.log('[sync] committed.');
	}

	console.log('[sync] done. Suggested verification:');
	console.log('[sync]   npm run typecheck-client');
	console.log('[sync]   npm run build-fast');
	console.log('[sync]   node custom/apply-trim.mjs --check');
	return 0;
}

if (isMainModule(import.meta.filename)) {
	process.exit(main());
}

export { main };
