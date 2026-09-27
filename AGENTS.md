# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

<!-- custom:begin agents-rules.md -->
# Fork rules — read before changing anything

This repo is a long-lived fork of `microsoft/vscode`. It is synced from upstream on a
schedule and **must merge without conflicts**. Everything below exists to protect that.

> Generated block: edit `custom/agents-rules.md`, not this file.
> Full detail: `custom/README.md`.

## The one idea

Never hand-edit a file upstream owns. Declare the change in `custom/trim.jsonc` and let
`custom/apply-trim.mjs` derive the file from **upstream's content**. A merge then has exactly
one correct answer, so it cannot conflict.

## Hard rules

1. **Work on `custom/main`, never on `main`.** `main` is a read-only mirror of upstream.
   Never commit there. Use `git merge`, never `git rebase`.
2. **Never delete an upstream file.** A deleted file conflicts on every upstream change to it
   (`modify/delete`). Comment out its `import` instead — the file stays, the feature goes.
3. **Never hand-edit a file listed in `custom/trim.jsonc`.** Those are derived artifacts; your
   edit will be silently overwritten on the next sync. Change `trim.jsonc` instead.
4. **Never edit inside a marker region.** Anything between `// [trim]` / `// [trim-add]` /
   `<!-- custom:begin -->` and its end marker is generated. Edit the source under `custom/`.
5. **Sync only with `node custom/sync.mjs`.** A raw `git merge` still works (a post-merge hook
   re-applies the trims) but `sync.mjs` also handles conflicts and commits correctly.
6. **Run the checks before committing** — see Workflow below. They are fast and they are the
   only thing standing between a trim list and a broken startup.
7. **Never `git config` the merge driver away, and never remove a file from `.gitattributes`
   `merge=trim` without removing it from `trim.jsonc` too.** A file routed to the driver but
   unknown to `trim.jsonc` gets regenerated from upstream — silently losing fork content.

## Which files are which

| Kind | Examples | How to change |
| --- | --- | --- |
| **Derived** (upstream-owned, regenerated) | `workbench.common.main.ts`, `workbench.desktop.main.ts`, `workbench.web.main.ts`, `build/next/index.ts`, `build/gulpfile.vscode.ts`, `AGENTS.md` | `custom/trim.jsonc` + `node custom/apply-trim.mjs` |
| **Fork-owned** (new files, never conflict) | `custom/**`, `src/vs/workbench/forkDefaults.contribution.ts`, `src/vs/workbench/forkDefaults.css`, `src/vs/workbench/forkPlugins.contribution.ts`, `extensions/fork-theme/**`, `extensions/fork-plugins-host/**`, `extensions/fork-plugin-*/**` | edit directly |
| **Hand-edited upstream** (small, marked `custom:`, reviewed each sync) | `product.json`, `package.json`, `build/npm/dirs.ts`, `build/lib/extensions.ts`, `build/hygiene.ts`, `browser/parts/globalCompositeBar.ts`, `browser/parts/auxiliarybar/auxiliaryBarPart.ts`, `browser/parts/titlebar/titlebarPart.ts` | edit directly, keep to one line |

### Built-in plugins (`extensions/fork-plugin-*`)

Plugins for this fork's right panel live as **one extension each**, named `fork-plugin-<id>`.
`extensions/fork-plugins-host/` owns the shared Secondary Side Bar container (`forkPlugins`)
and the selector setting (`fork.rightPanel.plugin`); each plugin contributes one webview view
gated by `when: config.fork.rightPanel.plugin == '<id>'`. Full rationale and the add-a-plugin
steps are in `extensions/fork-plugins-host/README.md`.

The panel is dedicated to **one** plugin at a time and that plugin owns the whole surface, so
two pieces of upstream chrome are removed for it:

* `AuxiliaryBarPart` no longer takes a title row (`hasTitle: false`), and its
  `shouldShowCompositeBar()` returns `false` while there is no title area. Without this,
  `PartLayout.layout` reserves 35px for the container switcher that row holds.
* `forkDefaults.css` hides the per-view header inside the auxiliary bar. `.pane` is a flex
  column and `.pane-body` is `flex: 1`, so the body absorbs the header's height.

Switching plugins is a **title bar** action, which is why it lives in workbench code
(`src/vs/workbench/forkPlugins.contribution.ts`) rather than in an extension: `titleBar` is not
among the menus the extension API exposes. It reads its candidate list from the setting's own
`enum`, so the button and the Settings dropdown cannot drift apart.

Two constraints from upstream that shape this and are easy to forget:

* The built-in extension scanner reads only `stat.children` of `<repo>/extensions` - it does
  **not** recurse. A plugin therefore has to be a direct child of `extensions/`; a shared
  parent directory would not be scanned at all.
* `viewsContainers` accepts only `id`, `title` and `icon` - there is **no `when`**, so a
  contributed container cannot be hidden conditionally. Only a *view* can. That is why the
  plugins share one container instead of each declaring its own.

Plugins need no registration anywhere: no entry in `build/npm/dirs.ts`, none in the gulpfile
compilation list, no `product.json` change. A plugin written in plain JavaScript with
`"main": "./extension.js"` needs no build step either. Adding a plugin means adding one folder
plus its id to the selector setting's `enum`.

### Marketplace (Open VSX)

`product.json` carries an `extensionsGallery` block pointing at **Open VSX**. Two things
follow, both deliberate:

* `product.json` is **strict JSON** - it is read with `JSON.parse` (build/hygiene.ts) and
  inlined by the build, so it must not contain comments. Explanations go here instead.
* `build/hygiene.ts` has an upstream guard that fails on any `extensionsGallery`. It is
  disabled in this fork, because the fork ships a Marketplace on purpose. The reason upstream
  keeps the guard is licensing: the Microsoft Marketplace only licenses VS Code itself, so a
  fork must stay on a Marketplace that licenses downstream products (Open VSX is run by the
  Eclipse Foundation for exactly that).

The official Open VSX values are documented at
<https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code>. Note that
`ExtensionGalleryManifestService` derives the latest-version URL as
`${serviceUrl}/vscode/{publisher}/{name}/latest`; Open VSX serves that path *and* the shorter
`${serviceUrl}/{publisher}/{name}/latest`, so VSCodium's `latestUrlTemplate` patch is not
needed here.

`extensions/fork-theme/` is a **fork-owned built-in extension** carrying the bundled
`Cursor Dark` theme. A purely declarative extension needs no registration: the built-in
scanner reads `<repo>/extensions/*`, packaging globs `extensions/*/package.json`, and only
TypeScript extensions need an entry in `build/npm/dirs.ts` or the gulpfile compilation list.
The default theme is set from `forkDefaults.contribution.ts` (`workbench.colorTheme`), which
must match `contributes.themes[].id` in that extension's `package.json`.

## Workflow

```sh
# after ANY change to custom/trim.jsonc or a fork-owned file
node custom/apply-trim.mjs          # apply
node custom/apply-trim.mjs --check  # must exit 0
node custom/check-trim.mjs          # must say "all trims verified safe"
npm run typecheck-client            # src/ - esbuild does NOT typecheck, so this is the only
                                    # thing that catches type errors in the hand-edited
                                    # upstream files and in forkDefaults.contribution.ts
npm run transpile-client            # dev runs from out/ - required before launching
custom\code-dev.cmd                 # launch

# after touching build/
(cd build && npm run typecheck)

# periodic upstream sync
node custom/sync.mjs
```

## Prefer a setting over a trim

Trimming a contribution is a blunt instrument and it can break DI. Before trimming, check
whether upstream already has a switch:

* **A setting / context key** → register a default from
  `src/vs/workbench/forkDefaults.contribution.ts` (a fork-owned file). Example: the built-in
  AI UI is hidden via upstream's own `chat.disableAIFeatures`, not by trimming chat.
* **A default value buried in code** → flip that one default in place, marked `custom:`, and
  list the file in the table above. Example: the account system is hidden by changing the
  fallback of `isAccountsActionVisible` (`browser/parts/globalCompositeBar.ts`) to `false`;
  it stays a storage preference, so a user can turn it back on.
* **A global setting with an unwanted second effect** → keep the setting, and pin the one
  place that should not follow it. Example: `workbench.activityBar.location: top` also moves
  the *secondary* side bar's activity items, so `resolveConfiguration` in
  `browser/parts/auxiliarybar/auxiliaryBarPart.ts` pins that part to `DEFAULT`. `PanelPart`
  already hardcodes `CompositeBarPosition.TITLE`, so the panel needs nothing.
* **A `when` clause or a view container** → hide it rather than remove it.
* **Only trim** when `check-trim.mjs` reports the module SAFE.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `SyntaxError: The requested module 'electron' does not provide an export named 'Menu'` | `ELECTRON_RUN_AS_NODE` is set in the environment; Electron degrades to plain Node | `Remove-Item Env:ELECTRON_RUN_AS_NODE` for the launch process |
| `Cannot find module ...preLaunch.ts`, or `.ts` fails to load | Node is older than 24 | put Node 24 on `PATH` (`nvm use 24.18.0`) |
| `[createInstance] X depends on Y which is NOT registered`, or `Unable to create workbench contribution` | a trimmed contribution registered a DI service that kept code still injects | `node custom/check-trim.mjs` → revert that entry in `trim.jsonc` → re-apply → re-transpile |
| `apply-trim --check` prints `NOT FOUND` | upstream renamed or moved the import | update that entry in `trim.jsonc` |
| `apply-trim --check` prints `STALE TRIM` | an entry was deleted from `trim.jsonc` without reverting the file | `node custom/apply-trim.mjs --restore`, then re-apply |
| `check-trim` prints `UNSAFE` | the trim would leave a reachable injector without a registration | do not trim that module; use a setting, or Phase 2 stubs |
| `check-trim` prints `INEFFECTIVE` | the module is still reachable through another live import, or someone imports a *value* from it | the trim does nothing; remove the entry or accept it |
| Merge conflict in `product.json` / `package.json` / `build/npm/dirs.ts` / `build/lib/extensions.ts` | these are hand-edited, not derived | resolve by hand; keep the change to one line |
| Trim changes have no effect in dev | `out/` is stale | `npm run transpile-client` |
| `tsc` reports `TS2367: comparison appears unintentional ... no overlap` | a `const` narrowed to a literal, so a comparison against another enum member is dead code | state the constant value directly instead of comparing, or widen the value without a `const` |
| Type errors that the dev build never showed | esbuild transpiles without typechecking | `npm run typecheck-client` (and `cd build && npm run typecheck`) before calling a change done |
| Editor: `Comments are not permitted in JSON` | a config file with comments must use `.jsonc` | rename to `.jsonc` |
| `git fetch upstream` pulls thousands of branches | the remote has the default `refs/heads/*` refspec | `node custom/setup.mjs --write` narrows it to `main` |
| `--agents` opens nothing | the Agents window entry points are trimmed by design | expected; do not pass `--agents` |
| The merge driver never runs | git only calls it when a file changed on **both** sides | expected; `sync.mjs` and the post-merge hook re-apply unconditionally |

## Do not

* Do not add a second mechanism for editing upstream files. Use the four kinds in
  `trim.jsonc`: `commentImports`, `commentLines`, `replacements`, `addLines`, `addBlocks`.
* Do not "fix" a merge conflict inside a derived file by editing it. Take upstream's version
  and re-run `node custom/apply-trim.mjs`.
* Do not assume a trim worked because the file changed. Confirm with
  `node custom/check-trim.mjs` (it reports INEFFECTIVE trims).
<!-- custom:end agents-rules.md -->
