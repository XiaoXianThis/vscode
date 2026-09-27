/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Fork defaults.
//
// This file is owned by the fork (custom/trim.jsonc adds its import to
// workbench.common.main.ts), so it never conflicts with upstream.
//
// It exists because desktop does not read `configurationDefaults` from product.json - only
// the web workbench does (src/vs/workbench/browser/web.api.ts). Registering the defaults here
// works identically in dev and in the packaged product.

import './forkDefaults.css';

import { ChatAIDisabledSettingId } from '../platform/chat/common/chatSettings.js';
import { Extensions, IConfigurationRegistry } from '../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../platform/registry/common/platform.js';
import { ActivityBarPosition, LayoutSettings } from './services/layout/browser/layoutService.js';

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerDefaultConfigurations([{
	source: 'forkDefaults',
	// `workbench.experimental.modernUI` is experiment-controlled, so without this the
	// assignment service could flip it back on.
	preventExperimentOverride: true,
	overrides: {
		// Turn the built-in AI surface off.
		//
		// This fork replaces the built-in AI with its own harness, so the AI UI should not
		// appear. `chat.disableAIFeatures` is upstream's own switch for exactly this: it hides
		// the chat auxiliary bar (layout.ts), the title bar AI entry point
		// (commandCenterControl.ts), the sign-in / "Build with Agent" setup prompts
		// (chatSetupContributions.ts) and the AI section of the settings UI (settingsLayout.ts).
		//
		// Using the setting rather than trimming the chat contributions matters. The chat
		// contribution modules register DI services and UI in the same file, and those services
		// are injected by code we keep - IChatService, ILanguageModelToolsService and
		// taskService all inject IMcpService. Commenting out
		// contrib/mcp/browser/mcp.contribution.js produced 64 startup DI errors; see
		// custom/README.md.
		[ChatAIDisabledSettingId]: true,

		// Flat panel separation.
		//
		// `workbench.experimental.modernUI` (default true) is what toggles both the
		// `floating-panels` and `modern-ui` classes on the workbench root
		// (WorkbenchLayoutService.isFloatingPanelsEnabled -> getLayoutClasses), and
		// `browser/media/floatingPanels.css` then gives the side bars and the bottom panel a
		// 4px margin, a 1px border and rounded corners each - one outline per panel. Turning
		// it off restores the classic presentation where adjacent parts share a single sash
		// line.
		[LayoutSettings.MODERN_UI]: false,

		// Activity Bar as a horizontal row at the top of the *primary* side bar.
		//
		// The setting is global - SidebarPart and AuxiliaryBarPart both follow it - so this
		// fork pins the secondary side bar to the default presentation instead
		// (browser/parts/auxiliarybar/auxiliaryBarPart.ts, marked `custom:`). PanelPart
		// already hardcodes CompositeBarPosition.TITLE and is unaffected. The icon row is
		// centered by forkDefaults.css.
		[LayoutSettings.ACTIVITY_BAR_LOCATION]: ActivityBarPosition.TOP,

		// Drop the command launcher / window-title search box from the title bar. The
		// back / forward navigation actions live in MenuId.CommandCenter, so they go with it.
		[LayoutSettings.COMMAND_CENTER]: false,

		// Explicit for intent; with the command center hidden the navigation controls are
		// already gone (see the `when` clause in parts/titlebar/titlebarActions.ts).
		'workbench.navigationControl.enabled': false,

		// Terminal IntelliSense suggestions off.
		//
		// The terminal suggest widget renders a hint under the suggestions
		// ("show suggestions (Ctrl+Space) to navigate input using the keyboard"). That string
		// does not exist anywhere in this repository, its dependencies, `out/`, the shell
		// integration scripts, or the user's PowerShell profile - so it cannot be targeted
		// directly, and turning the feature off is the only reliable lever.
		//
		// `terminal.integrated.suggest.enabled` is defined in
		// contrib/terminalContrib/suggest/common/terminalSuggestConfiguration.ts (default true)
		// and gates the whole feature: the addon, the completions provider and the widget.
		'terminal.integrated.suggest.enabled': false,

		// Bundled theme, as the default dark theme.
		//
		// The theme ships in `extensions/fork-theme/` - a fork-owned built-in extension. It is
		// picked up exactly like `extensions/theme-defaults`: the built-in scanner reads
		// `<repo>/extensions/*` and packaging globs `extensions/*/package.json`, and a purely
		// declarative extension needs no entry in build/npm/dirs.ts or in the gulpfile
		// compilation list. So there is no registration step anywhere.
		//
		// The value must match `contributes.themes[].id` in that extension's package.json.
		// Setting both the theme and the preferred dark theme covers `window.autoDetectColorScheme`.
		'workbench.colorTheme': 'Cursor Dark',
		'workbench.preferredDarkColorTheme': 'Cursor Dark',

		// Show the secondary side bar (the right panel) when a workspace or window is opened for
		// the first time, because that is where this fork's plugins live
		// (extensions/fork-plugins-host). Upstream defaults to 'visibleInWorkspace' but skips the
		// bar entirely when AI features are off - which is this fork's default - so without this
		// the plugin panel would never appear on its own.
		'workbench.secondarySideBar.defaultVisibility': 'visible',
	},
}]);
