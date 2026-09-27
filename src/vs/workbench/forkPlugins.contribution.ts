/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../base/common/codicons.js';
import { localize, localize2 } from '../nls.js';
import { Action2, MenuId, registerAction2 } from '../platform/actions/common/actions.js';
import { IConfigurationPropertySchema, IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService } from '../platform/configuration/common/configuration.js';
import { ServicesAccessor } from '../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../platform/quickinput/common/quickInput.js';
import { Registry } from '../platform/registry/common/platform.js';

/**
 * Which built-in chat plugin fills the right panel. Declared by
 * `extensions/fork-plugins-host/package.json`, which also owns the shared Secondary Side Bar
 * container every plugin contributes its view into.
 */
const FORK_CHAT_PLUGIN_SETTING = 'fork.rightPanel.plugin';

/**
 * Switches the right panel between this fork's chat plugins.
 *
 * This lives in the workbench rather than in an extension for one concrete reason: the plugins
 * are extensions, and `titleBar` is not one of the menus the extension API exposes
 * (`menusExtensionPoint.ts` lists the API menus), so an extension cannot put a button here.
 *
 * The candidate list comes from the selector setting's own `enum`, so the button and the
 * Settings dropdown can never disagree about which plugins exist.
 */
class SelectChatPluginAction extends Action2 {

	static readonly ID = 'fork.plugins.selectChatPlugin';

	constructor() {
		super({
			id: SelectChatPluginAction.ID,
			title: localize2('fork.plugins.selectChatPlugin', "Select Chat Plugin"),
			icon: Codicon.commentDiscussion,
			f1: true,
			menu: {
				id: MenuId.TitleBar,
				group: 'navigation',
				order: 10,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const quickInputService = accessor.get(IQuickInputService);

		const schema = this.getSchema();
		const ids = Array.isArray(schema?.enum) ? schema.enum.map((id: unknown) => String(id)) : [];
		if (!ids.length) {
			return;
		}

		const descriptions = Array.isArray(schema?.enumDescriptions) ? schema.enumDescriptions : [];
		const current = configurationService.getValue<string>(FORK_CHAT_PLUGIN_SETTING);

		const items: (IQuickPickItem & { pluginId: string })[] = ids.map((id: string, index: number) => ({
			pluginId: id,
			label: id,
			description: descriptions[index],
			detail: id === current ? localize('fork.plugins.current', "Currently shown") : undefined,
		}));

		const picked = await quickInputService.pick(items, {
			placeHolder: localize('fork.plugins.pickPlaceHolder', "Select the plugin shown in the right panel"),
		});

		if (picked && picked.pluginId !== current) {
			await configurationService.updateValue(FORK_CHAT_PLUGIN_SETTING, picked.pluginId);
		}
	}

	private getSchema(): IConfigurationPropertySchema | undefined {
		const properties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
		return properties[FORK_CHAT_PLUGIN_SETTING];
	}
}

registerAction2(SelectChatPluginAction);
