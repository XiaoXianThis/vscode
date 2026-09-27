/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Fork contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const vscode = require('vscode');

const VIEW_ID = 'fork.plugin.notes';

/**
 * Demonstrates the webview -> extension direction and a reply: the webview reports what the
 * user typed, the extension answers with a summary.
 *
 * The note text itself is deliberately not stored here. A webview is torn down whenever
 * another plugin is selected, and the text lives in the webview's own state
 * (`vscode.setState`) so it comes back when the view does.
 */
class NotesViewProvider {

	constructor(extensionUri) {
		this.extensionUri = extensionUri;
	}

	resolveWebviewView(webviewView) {
		const { webview } = webviewView;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};
		webview.html = getHtml(webview, this.extensionUri);

		webviewView.onDidDispose(() => {
			// Nothing to release: this plugin holds no timers or files.
		});

		webview.onDidReceiveMessage(message => {
			if (!message || message.type !== 'change' || typeof message.text !== 'string') {
				return;
			}
			const trimmed = message.text.trim();
			void webview.postMessage({
				type: 'summary',
				characters: message.text.length,
				words: trimmed ? trimmed.split(/\s+/).length : 0,
			});
		});
	}
}

function getHtml(webview, extensionUri) {
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
	const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};`;

	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Notes</title>
</head>
<body>
	<main class="plugin">
		<h1 class="plugin-title">Notes</h1>
		<p class="plugin-lead">
			Type below. The text is kept in the webview's own state, so it survives switching to
			another plugin and back.
		</p>
		<div class="plugin-field plugin-fill">
			<label for="note">Note</label>
			<textarea id="note" class="plugin-input plugin-textarea plugin-fill" spellcheck="false"></textarea>
		</div>
		<!-- The summary only changes in response to typing, so a polite live region is enough. -->
		<p class="plugin-footer" id="summary" role="status" aria-live="polite">0 words, 0 characters</p>
	</main>
	<script src="${scriptUri}"></script>
</body>
</html>`;
}

function activate(context) {
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, new NotesViewProvider(context.extensionUri))
	);
}

module.exports = { activate };
