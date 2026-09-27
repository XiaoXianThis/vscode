# Fork Chat Plugins

The built-in plugin system for this fork's right panel. The right panel is dedicated to
**exactly one chat plugin at a time**, and that plugin owns the whole surface.

| Piece | What it is |
| --- | --- |
| `extensions/fork-plugins-host/` | **This extension.** Declares the shared Secondary Side Bar container (`forkPlugins`, titled *Chat*) and the selector setting (`fork.rightPanel.plugin`). Declarative only - no code. |
| `extensions/fork-plugin-<id>/` | **One extension per plugin.** Each contributes exactly one webview view into `forkPlugins`. |
| `fork.rightPanel.plugin` | Picks which plugin is shown. Each plugin's view carries `when: config.fork.rightPanel.plugin == '<id>'`, so exactly one is visible at a time. |
| Title bar button | **Select Chat Plugin** (`fork.plugins.selectChatPlugin`) switches between them. |

## Why the panel has no chrome of its own

Two upstream pieces of chrome were removed so the plugin fills the panel:

* **The part's title row.** `AuxiliaryBarPart` passed `hasTitle: true`, which made
  `PartLayout.layout` reserve 35px for the view container switcher. It is now `false`, and
  `shouldShowCompositeBar()` returns `false` while there is no title area, because the switcher
  lives in that row. `createTitleArea`, `layoutEmptyMessage` and `updateCompositeBar` all
  already guard against an absent composite bar.
* **The per-view header.** PaneView renders one; `forkDefaults.css` hides it inside the
  auxiliary bar only. `.pane` is a flex column and `.pane-body` is `flex: 1`, so the body takes
  the header's height instead of leaving a gap.

The switcher therefore lives in the **title bar**, which is why `forkPlugins.contribution.ts`
is workbench code and not an extension: `titleBar` is not among the menus the extension API
exposes, so no extension can put a button there. That action reads the candidate list from this
setting's own `enum`, so the button and the Settings dropdown cannot drift apart.

## Why one container instead of one per plugin

`viewsContainers` accepts `id`, `title` and `icon` - **there is no `when`**, so a contributed
container cannot be hidden conditionally. A view *can*. Contributing one container per plugin
would therefore leave every plugin's icon in the Secondary Side Bar forever, and the unselected
ones would open empty.

The shared container sidesteps that: one container, and the selected plugin's view owns it.

## Why each plugin is its own top-level folder

The built-in extension scanner reads `stat.children` of `<repo>/extensions` and does **not** recurse
(`scanExtensionsFromLocation` in `src/vs/platform/extensionManagement/common/extensionsScannerService.ts`).
So `extensions/fork-plugins/<id>/package.json` would never be found - every plugin has to be a direct child of
`extensions/`. Hence the shared `fork-plugin-` prefix rather than a shared parent directory.

## Adding a plugin

1. Copy `extensions/fork-plugin-hello/` to `extensions/fork-plugin-<id>/`.
2. Rename `name` in its `package.json` to `fork-plugin-<id>`.
3. Give it a unique view id - the convention is `fork.plugin.<id>` - and set
   `"when": "config.fork.rightPanel.plugin == '<id>'"`.
4. Add an `icon` pointing at an SVG in its own `media/`. The `views` JSON schema marks `icon` as
   required, so omitting it makes the editor report *Missing property "icon"*. Note that upstream
   itself does not always follow this - `extensions/references-view` contributes a view without an
   icon, and `IUserFriendlyViewDescriptor.icon` is typed optional - so the warning is a
   schema/implementation mismatch rather than a runtime failure. Add it anyway: the icon is what
   the views overflow menu and drag-and-drop use.
5. Add `<id>` to the `enum` (and `enumDescriptions`) of `fork.rightPanel.plugin` in **this** extension's
   `package.json`. This is the only central file a plugin touches, and the title bar button reads
   its list from here.
6. Add `vscode.window.registerWebviewViewProvider('fork.plugin.<id>', ...)` in its `activate`.

Nothing else is needed: the built-in scanner picks the folder up in dev, and packaging globs
`extensions/*/package.json`. A plugin with no `main` needs no build step at all; a plugin that wants
TypeScript adds `tsconfig.json` plus `esbuild.mts` (the packaging step bundles it and rewrites `main`
from `out/` to `dist/`).

## Conventions

- **Plugins never import each other.** They are separate extensions and cannot share source; duplicate the
  little you need, or bundle shared code in through your own `esbuild.mts`.
- **Theme tokens only.** Webview CSS uses `--vscode-*` variables so plugins follow the active theme and
  high-contrast modes.
- **Fill the panel.** A webview view owns its whole area, so the body should be a full-height flex column
  with no outer margins.
- **Accessibility.** Label controls, keep everything keyboard reachable, and use `aria-live="polite"` for
  content that updates on its own (see `fork-plugin-clock`).
