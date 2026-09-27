# custom/ — this fork's trim layer

This directory is the **only** place where this fork differs from upstream in a way that
matters structurally. Everything here exists so that `git merge upstream/main` can be run
on a schedule without ever producing a conflict in the files we modify.

## The idea in one paragraph

VS Code decides which features exist in one place: the *aggregation entry files*
(`src/vs/workbench/workbench.common.main.ts`, `workbench.desktop.main.ts`,
`workbench.web.main.ts`, `src/vs/sessions/sessions.*.main.ts`). They are lists of
side-effect `import '...'` lines. Comment out a line and that feature's contributions are
never registered — in dev and in the bundle alike. So instead of deleting files or
hand-editing those lists, we keep a machine-readable list of lines to comment out
(`trim.jsonc`) and regenerate the entry files from whatever upstream content is on disk.

Two consequences:

* **We never physically delete an upstream file.** A deleted file conflicts on every
  upstream change to it (`modify/delete`); a file that is merely not imported conflicts
  never.
* **We never hand-edit an upstream file's content.** `trim.jsonc` is the source of truth;
  the entry files, the build lists and `AGENTS.md` are all derived artifacts.

## Files

| File | Purpose |
| --- | --- |
| `trim.jsonc` | The list. Declarative edits applied to upstream files. |
| `agents-rules.md` | The fork rules, injected into `AGENTS.md` as a generated block. |
| `lib/trim-core.mjs` | Shared helpers (no dependencies, runs before `npm install`). |
| `apply-trim.mjs` | Applies / verifies / reverts `trim.jsonc`. Idempotent. |
| `check-trim.mjs` | Static safety check: will any trim break DI at runtime? |
| `merge-trim.mjs` | git merge driver for the derived files. |
| `sync.mjs` | One command for the periodic upstream sync. |
| `setup.mjs` | One-time per-clone setup (merge driver config + post-merge hook). |
| `code-dev.cmd` | Dev launcher that skips the built-in AI extensions. |

## Edit kinds

`trim.jsonc` supports five declarative edits. All are idempotent, reversible, and re-derived
from upstream's content on every merge.

| Kind | Shape | Use for |
| --- | --- | --- |
| `commentImports` | `{ "<file>": ["<specifier>"] }` | side-effect `import '...'` lines in aggregation entry files |
| `commentLines` | `{ "<file>": ["<exact line>"] }` | array elements (build entry points, gulp task lists), all occurrences |
| `replacements` | `[{ file, find, replace }]` | where commenting out is invalid, e.g. an import list |
| `addLines` | `{ "<file>": ["<line>"] }` | appending fork-owned *code* lines at the end of a TS file |
| `addBlocks` | `{ "<file>": ["<path under custom/>"] }` | injecting a fork-owned *document* region into a markdown file |

`addLines` and `addBlocks` are what let the fork add content to an upstream file. They exist
because the entry files are the only place a workbench contribution can be registered, and
`AGENTS.md` is the only file every agent session reads — both upstream-owned.

### `addBlocks` and AGENTS.md

`AGENTS.md` is upstream-owned, but it is the one file an agent is guaranteed to read, so the
fork rules have to live there. `trim.jsonc` therefore maps it to `custom/agents-rules.md`:

```
<!-- custom:begin agents-rules.md -->
...generated from custom/agents-rules.md...
<!-- custom:end agents-rules.md -->
```

The region is **generated output**. Editing the rules inside `AGENTS.md` is caught rather than
silently lost: `apply-trim.mjs --check` reports `NOT APPLIED in AGENTS.md` and the next apply
rewrites the region from the source file. Edit `custom/agents-rules.md` instead.

Verified behaviours: the block survives an upstream change to `AGENTS.md` (the merge driver
re-derives upstream's version and re-appends), `--restore` removes it completely, and a
hand-edit inside the region fails `--check`.

## One-time setup (per clone)

```sh
node custom/setup.mjs            # show what would change
node custom/setup.mjs --write    # apply it
```

That sets `merge.trim.driver` and installs `.git/hooks/post-merge`. Both live in `.git/`
and are therefore not versioned — re-run after every fresh clone.

## The weekly sync

```sh
git switch custom/main
node custom/sync.mjs             # fetch + merge + re-apply trim + commit
```

Then verify:

```sh
node custom/apply-trim.mjs --check
npm run typecheck-client
npm run build-fast
```

## Running the fork in dev

```sh
custom\code-dev.cmd              # wraps scripts\code.bat, skips built-in AI extensions
```

It only sets `VSCODE_SKIP_BUILTIN_EXTENSIONS=GitHub.copilot-chat,GitHub.copilot`, which
`extensionsScannerService.ts` honours when scanning built-in extensions. That keeps the dev
window matching the shipped product without editing `scripts/code.bat`.

Two environment gotchas, both hit on the first launch:

* **Node must be 24** on `PATH` before `code-dev.cmd` runs, otherwise `preLaunch.ts` cannot
  load its own TypeScript. Without changing the machine's global version:
  `$env:PATH = "E:\Runtime\nvm\v24.18.0;" + $env:PATH` (or `nvm use 24.18.0`).
* **`ELECTRON_RUN_AS_NODE` must not be set.** If the shell inherits it, `Code - OSS.exe`
  degrades into plain Node and dies with
  `SyntaxError: The requested module 'electron' does not provide an export named 'Menu'`.
  Clear it for the launch process only: `Remove-Item Env:ELECTRON_RUN_AS_NODE`.

After changing `trim.jsonc` you must re-transpile before relaunching — dev runs from `out/`:

```sh
npm run transpile-client         # ~11s for 9399 files
```

## How the built-in AI is turned off

**Not** by trimming its contributions. The chat contribution modules register DI services and
UI in the same file, and those services are injected by code this fork keeps —
`IChatService`, `ILanguageModelToolsService` and **`taskService`** all inject `IMcpService`.
Commenting out `contrib/mcp/browser/mcp.contribution.js` produced 64 startup DI errors. The
reverted modules and the service each one would have taken down are listed in `trim.jsonc`.

Instead, `src/vs/workbench/forkDefaults.contribution.ts` (a fork-owned file) registers
upstream's own switch as a default:

```ts
registerDefaultConfigurations([{ source: 'forkDefaults', overrides: { 'chat.disableAIFeatures': true } }]);
```

That single setting hides the chat auxiliary bar (`workbench/browser/layout.ts`), the title bar
AI entry point (`parts/titlebar/commandCenterControl.ts`), the sign-in / "Build with Agent"
setup prompts (`chatSetup/chatSetupContributions.ts`) and the AI section of the settings UI
(`contrib/preferences/browser/settingsLayout.ts`) — while every service stays registered.

Two supporting details:

* Desktop does **not** read `configurationDefaults` from `product.json`; only the web workbench
  does (`src/vs/workbench/browser/web.api.ts`). Hence a code registration.
* The file is wired in through `addLines` in `trim.jsonc`, because the merge driver regenerates
  the entry files from upstream content and would otherwise drop a hand-added import:

  ```jsonc
  "addLines": { "src/vs/workbench/workbench.common.main.ts": ["import './forkDefaults.contribution.js';"] }
  ```

  `addLines` appends the lines at end of file under a `// [trim-add]` marker, which is what
  makes them removable by `--restore` even after the entry is deleted from the list.

To re-enable the built-in AI for a session: set `chat.disableAIFeatures` to `false` in user
settings. Third-party chat / `vscode.lm` extensions keep working either way, because nothing
was unregistered.

## Phases

The AI removal is deliberately split in two. Phase 1 is applied and verified against a real
launch; Phase 2 needs `custom/stubs/` and another launch to validate.

### Phase 1 — applied and verified (contribution level)

Removes the Agents window build entry points, the copilot built-in extension, the whole
welcome/onboarding/survey/splash/process-explorer surface, and the AI contributions that
`check-trim.mjs` can prove are safe.

**The lesson from the first launch attempt:** the built-in AI's contribution modules are
*mixed* — they register DI services and UI in the same file. `contrib/mcp/browser/mcp.contribution.ts`
is the clearest case: one line registers `IMcpService`, which `IChatService`,
`ILanguageModelToolsService` and **`taskService`** all inject. Commenting out its entry import
produced 64 startup errors, including task and debug status-bar contributions. It and six
other modules were reverted; the reasons are recorded inline in `trim.jsonc`.

What Phase 1 actually removes of the AI, all verified safe:

| Trimmed | Note |
| --- | --- |
| `contrib/mcp/browser/mcp.view.contribution.js` | the MCP sidebar view (UI only) |
| `contrib/chat/browser/chat.view.contribution.js` | agent plugins view |
| `contrib/chat/browser/contextContrib/chatContext.contribution.js` | |
| `contrib/chat/browser/remoteAgentHost/remoteAgentHost.contribution.js` | |
| `contrib/chat/browser/onboarding/modelPickerTryout.contribution.js` | |
| `contrib/chat/electron-browser/tunnelHost.contribution.js` | |
| `contrib/agentsVoice/browser/agentsVoice.contribution.js` | 319 KB |
| `contrib/agentsVoice/electron-browser/agentsVoiceNativeCommands.js` | |
| `contrib/imageCarousel/browser/imageCarousel.contribution.js` | |
| `contrib/remoteCodingAgents/browser/remoteCodingAgents.contribution.js` | |
| `contrib/onboarding/browser/onboarding.contribution.js` | |

Plus, in the desktop build, the Agents window entry points in `build/next/index.ts` and the
copilot packaging task in `build/gulpfile.vscode.ts`.

**Reverted in Phase 1, because they register services that kept code injects:**

| Module | Service that would be lost |
| --- | --- |
| `contrib/mcp/browser/mcp.contribution.js` | `IMcpService`, `IMcpRegistry`, `IMcpWorkbenchService`, + 6 more |
| `contrib/mcp/electron-browser/mcp.contribution.js` | `IWorkbenchMcpGatewayService`, `IMcpDevModeDebugging` |
| `contrib/chat/browser/chat.contribution.js` | `IChatResponseFileChangesService` |
| `contrib/chat/browser/agentSessions/agentHost/agentHost.contribution.js` | `IAgentHostByokLmHandler` |
| `contrib/inlineChat/browser/inlineChat.contribution.js` | `IInlineChatSessionService` (also injected by notebook cells) |
| `contrib/editTelemetry/browser/editTelemetry.contribution.js` | `IAiEditTelemetryService` |
| `contrib/onboarding/electron-browser/onboardingTryout.contribution.js` | `IOnboardingTryoutHandoffService` |
| `contrib/chat/browser/chatSessions/chatSessions.contribution.js` | *ineffective*: `mainThreadChatSessions.ts` and `chat.contribution.ts` import values from it |

### Phase 2 — not applied (service level)

To actually drop `contrib/chat/browser` (~12 MB), `platform/agentHost` (~21.6 MB) and the
chat/mcp service implementations, `chat.shared.contribution.js` and the AI service
registrations in `workbench.common.main.ts` have to go, which requires dealing with the
references below — today that means editing ~15 upstream files, exactly the conflict surface
this whole setup exists to avoid.

Measured surviving references (non-test, excluding the removed areas themselves):

| Interface | Surviving referrers |
| --- | --- |
| `IChatService` | `terminalContrib/chat`, `terminalContrib/chatAgentTools`, `tasks`, `update` |
| `IChatAgentService` | `notebook/browser`, `terminalContrib/chat`, `terminalContrib/inlineHint`, `codeEditor`, `quickaccess`, `tasks` |
| `IChatWidgetService` | `terminalContrib/chatAgentTools`, `terminalContrib/chat`, `notebook`, `search`, `codeEditor`, `debug`, `scm`, `terminal` |
| `ILanguageModelToolsService` | `terminalContrib/chatAgentTools`, `extensions`, `testing` |
| `IChatSessionsService` | `terminalContrib/chat`, `terminalContrib/chatAgentTools` |
| `IChatEditingService` | `scm` |
| `ILanguageModelsService` | `issue` |
| `IAgentHostService` | `workbench/browser/actions/developerActions.ts` |
| `IChatEntitlementService` | 9 areas — **must keep**, including `preferences` and `inlineCompletions` |
| `IMcpResourceScannerService` | main process (`sharedProcessMain`, `cliProcessMain`, `serverServices`) — **must keep** |

Clean to remove (zero surviving references): `IAISettingsSearchService`,
`IAIRelatedInformationService`, `IAIEmbeddingVectorService`,
`ICustomizationMarketplaceService`, `INetworkFilterService`, `IPromptsService`,
`IAgentPluginService`, `ILanguageModelToolsConfirmationService`.

Caveat on `platform/networkFilter`: only `INetworkFilterService` is unreferenced, but the
module also exports `IAgentNetworkFilterService`, which `platform/browserView/*` uses. Since
`contrib/browserView` is deliberately kept (it is the natural host for the harness Web UI),
`platform/networkFilter` has to stay too.

The way to get Phase 2 without touching those 15 files is to add `custom/stubs/` — a small
Proxy-based no-op service registered for each dropped interface, imported from the entry file
(the one line we already own). Injection then resolves, and any actual call is a programming
error that cannot happen because the UI that would call it is gone. This still needs a
build + run to shake out constructors that call a method eagerly.

## Environment notes

* **Node 24 is required.** `.nvmrc` pins `24.18.0`. `scripts/code.bat` runs
  `node build/lib/preLaunch.ts` with no flags, which needs Node's unflagged TypeScript
  loading — that only exists from Node 22.18/23.6 onward, so 22.17 fails outright.
* **bun cannot replace npm here.** `build/npm/postinstall.ts` shells out to `npm`/`npm.cmd`
  per directory (see `build/npm/dirs.ts`, ~45 dirs), sets `npm_config_*` env vars, and uses a
  bundled `node-gyp`. Native modules, the electron download and the sub-package installs are
  all npm-driven. bun can run the scripts in `custom/`, but not the build.


## Branch model

* `main` — a mirror of `upstream/main`. **Never commit here.**
* `custom/main` — the long-lived branch that carries the fork.

Use `git merge`, not `git rebase`: conflicts are resolved once per merge instead of once
per replayed commit, and there is no force-push.

## Adding or removing a trim

1. Edit `trim.jsonc`.
2. `node custom/apply-trim.mjs`
3. `node custom/check-trim.mjs` — must report `all trims verified safe`.
4. Commit.

Two hard failures guard the list against rot:

* `apply-trim.mjs --check` fails with `NOT FOUND` when a listed specifier no longer exists
  upstream (renamed or moved) — that is the signal to update `trim.jsonc`.
* It also fails with `STALE TRIM` when a file carries a `// [trim]` marker that no longer
  matches any entry. This is the case where an entry was deleted from `trim.jsonc` without
  reverting the file, which would otherwise keep the feature silently trimmed forever.
  `--restore` is therefore a blind sweep of the marker, not a replay of the list.

## Why `check-trim.mjs` exists

Commenting out a side-effect import looks harmless but is not: a contribution module usually
registers DI services *and* UI in the same file. If a service it registers ends up registered
nowhere, every reachable file that injects it fails at startup with

```
[createInstance] X depends on Y which is NOT registered
```

This happened on the first launch of this fork: trimming `contrib/mcp/browser/mcp.contribution.js`
removed `IMcpService`, which `IChatService`, `ILanguageModelToolsService` **and `taskService`**
inject — 64 errors from one line, with `taskService` and debug/task status bar contributions
failing along with it.

`check-trim.mjs` predicts that without a build. For every trimmed module it reports:

* **INEFFECTIVE** — the module is still reachable through another live import, so the trim does
  nothing (and the module's registrations are *not* lost, so nothing breaks).
* **UNSAFE** — the module is unreachable, and a reachable file still injects a service it
  registered. Static analysis cannot distinguish eager (constructor) from lazy injection, so
  UNSAFE means "verify against a real launch"; the runtime log remains the authority.
* **SAFE** — nothing reachable depends on it.

A module that other code imports a *value* from can never be trimmed this way; that shows up as
INEFFECTIVE.

## Why the post-merge hook exists (the non-obvious part)

Git only invokes a custom merge driver when a file changed on **both** sides. The common
case is the opposite: we have not touched the entry file since the last sync, upstream
has. Git then resolves that file itself by taking upstream's version, the merge driver is
never called, and our trims would be **silently dropped**.

So the merge driver is not sufficient on its own. `custom/sync.mjs` always runs
`apply-trim.mjs` after the merge, and the `post-merge` hook does the same for plain
`git merge` / `git pull`. Both are needed.

## Files we still edit by hand (and therefore can conflict)

Everything structural is derived from `trim.jsonc`, including `build/next/index.ts` and
`build/gulpfile.vscode.ts`. What is left are single-value edits that do not fit the
comment/replace model:

| File | Edit |
| --- | --- |
| `product.json` | branding, `builtInExtensions`, `defaultChatAgent` |
| `build/lib/extensions.ts` | add an extension folder name to `excludedExtensions` |
| `build/gulpfile.extensions.ts` | remove an extension's `tsconfig.json` from `compilations` |
| `build/npm/dirs.ts` | remove an install directory |
| `package.json` | script wiring (e.g. dropping `compile-copilot`) |

Keep these to one-line changes where possible; they are reviewed by hand on every sync.
`build/npm/dirs.ts` and `package.json` are deliberately untouched for now: leaving
`extensions/copilot` in the install list keeps `npm run compile` working, and copilot is
already kept out of the packaged product by the `trim.jsonc` entry in `build/gulpfile.vscode.ts`.

## Known upstream quirk

`product.json`'s `configurationDefaults` is only read by the **web** workbench
(`src/vs/workbench/browser/web.api.ts`). On desktop it is ignored, so default settings for
this fork have to be registered from code (`registerDefaultConfigurations`), not from
`product.json`.
