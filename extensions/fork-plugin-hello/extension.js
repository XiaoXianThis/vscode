/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Fork contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const vscode = require('vscode');

const VIEW_ID = 'fork.plugin.hello';

/**
 * The smallest possible plugin: it renders once and never talks to the extension host, so it
 * needs neither scripts nor a message handler.
 */
class HelloViewProvider {

	constructor(extensionUri) {
		this.extensionUri = extensionUri;
	}

	resolveWebviewView(webviewView) {
		const { webview } = webviewView;
		webview.options = {
			// Static content - keep scripts off so the webview cannot execute anything.
			enableScripts: false,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};
		webview.html = getHtml(webview, this.extensionUri);
	}
}

function getHtml(webview, extensionUri) {
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
	// No 'unsafe-inline': the stylesheet is the only external resource this plugin loads.
	const csp = `default-src 'none'; style-src ${webview.cspSource};`;

	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Hello</title>
</head>
<body>
	<main class="plugin">
		<h1 class="plugin-title">Hello</h1>
		<p class="plugin-lead">
			The smallest possible fork plugin: one webview view, one extension, no build step and no scripts.
		</p>
		<ul class="plugin-list">
			<li>Registered for the shared <code>forkPlugins</code> container.</li>
			<li>Visible only while <code>fork.rightPanel.plugin</code> is <code>hello</code>.</li>
			<li>Owns the whole panel, so the body is a full-height flex column.</li>
		</ul>
	</main>
</body>
</html>`;
}

function activate(context) {
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, new HelloViewProvider(context.extensionUri))
	);
}

module.exports = { activate };
