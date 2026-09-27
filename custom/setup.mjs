/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// custom/setup.mjs
//
// One-time, per-clone setup of the machinery that keeps upstream merges conflict free:
//
//   1. a git merge driver for the derived aggregation files (see custom/merge-trim.mjs)
//   2. a post-merge hook that re-applies custom/trim.jsonc after every merge
//
// This intentionally touches .git/config and .git/hooks, which are not versioned, so it
// has to be re-run once per fresh clone. Run it with --write to actually apply:
//
//   node custom/setup.mjs            # show what would change
//   node custom/setup.mjs --write    # apply

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule, loadTrimConfig, ownedFiles, ROOT } from './lib/trim-core.mjs';

const GIT = process.platform === 'win32' ? 'git.exe' : 'git';
const DRIVER = 'node custom/merge-trim.mjs %O %A %B %A';

const POST_MERGE_HOOK = `#!/bin/sh
# Installed by custom/setup.mjs - do not edit by hand.
# Re-applies custom/trim.jsonc after every merge, because git resolves the common
# "only upstream changed" case on its own and would otherwise drop the trims.
if [ -f custom/apply-trim.mjs ]; then
	node custom/apply-trim.mjs || echo "custom: apply-trim.mjs failed - run it manually" >&2
	if ! git diff --quiet -- src/vs/workbench src/vs/sessions; then
		echo "custom: trim re-applied after merge - review and commit the change." >&2
		git --no-pager diff --stat -- src/vs/workbench src/vs/sessions >&2
	fi
fi
`;

function main(argv = process.argv.slice(2)) {
	const write = argv.includes('--write');

	const entries = [...ownedFiles(loadTrimConfig())];
	const gitattributes = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
	const missingAttributes = entries.filter(f => !gitattributes.includes(`${f} merge=trim`));

	console.log('[setup] git merge driver:');
	console.log(`[setup]   git config --local merge.trim.name "custom trim driver"`);
	console.log(`[setup]   git config --local merge.trim.driver "${DRIVER}"`);
	console.log('[setup] upstream remote (narrow the fetch refspec to main only):');
	console.log('[setup]   git config --local remote.upstream.fetch "+refs/heads/main:refs/remotes/upstream/main"');
	console.log('[setup] post-merge hook:');
	console.log('[setup]   .git/hooks/post-merge');
	if (missingAttributes.length > 0) {
		console.warn('[setup] WARNING: .gitattributes does not route these files to the driver:');
		for (const f of missingAttributes) {
			console.warn(`[setup]   ${f} merge=trim`);
		}
	}

	if (!write) {
		console.log('[setup] dry run. Re-run with --write to apply.');
		return 0;
	}

	execFileSync(GIT, ['config', '--local', 'merge.trim.name', 'custom trim driver'], { cwd: ROOT, stdio: 'inherit' });
	execFileSync(GIT, ['config', '--local', 'merge.trim.driver', DRIVER], { cwd: ROOT, stdio: 'inherit' });
	execFileSync(GIT, ['config', '--local', 'remote.upstream.fetch', '+refs/heads/main:refs/remotes/upstream/main'], { cwd: ROOT, stdio: 'inherit' });

	const hooksDir = path.join(ROOT, '.git', 'hooks');
	fs.mkdirSync(hooksDir, { recursive: true });
	const hookPath = path.join(hooksDir, 'post-merge');
	if (fs.existsSync(hookPath) && !fs.readFileSync(hookPath, 'utf8').includes('custom/setup.mjs')) {
		console.warn(`[setup] ${hookPath} already exists and was not written by us - leaving it alone.`);
	} else {
		fs.writeFileSync(hookPath, POST_MERGE_HOOK.replaceAll('\n', '\n'));
		try {
			fs.chmodSync(hookPath, 0o755);
		} catch {
			// chmod is a no-op on Windows; git for Windows runs the hook via sh anyway.
		}
		console.log(`[setup] wrote ${path.relative(ROOT, hookPath)}`);
	}

	console.log('[setup] done.');
	return 0;
}

if (isMainModule(import.meta.filename)) {
	process.exit(main());
}
