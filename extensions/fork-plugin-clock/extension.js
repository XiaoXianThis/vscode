/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Fork contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const vscode = require('vscode');

const VIEW_ID = 'fork.plugin.clock';

/**
 * Demonstrates the extension -> webview direction: the extension owns a timer and pushes a
 * message every second.
 *
 * The webview asks for the first value with a `ready` message instead of the extension
 * pushing immediately, because a message posted before the webview has loaded its script is
 * dropped.
 */
class ClockViewProvider {

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

		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		let timer;

		const stop = () => {
			if (timer !== undefined) {
				clearInterval(timer);
				timer = undefined;
			}
		};
		const start = () => {
			stop();
			const tick = () => void webview.postMessage({ type: 'tick', epochMs: Date.now(), timeZone });
			tick();
			timer = setInterval(tick, 1000);
		};

		// A hidden view does not need a running timer - the secondary side bar hides the panel
		// whenever another container is selected.
		const disposables = [
			webview.onDidReceiveMessage(message => {
				if (message && message.type === 'ready') {
					start();
				}
			}),
			webviewView.onDidChangeVisibility(() => webviewView.visible ? start() : stop()),
			webviewView.onDidDispose(() => {
				stop();
				while (disposables.length) {
					disposables.pop().dispose();
				}
			}),
		];
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
	<title>Clock</title>
</head>
<body>
	<main class="plugin">
		<h1 class="plugin-title">Clock</h1>
		<p class="plugin-lead">The extension pushes a tick every second while this view is visible.</p>
		<div class="plugin-readout">
			<!--
				role="timer" with aria-live off on purpose: announcing every tick would flood a
				screen reader. The value stays readable on demand instead.
			-->
			<span class="plugin-clock" id="clock" role="timer" aria-live="off" aria-label="Current time">--:--:--</span>
		</div>
		<p class="plugin-hint" id="zone"></p>
		<p class="plugin-footer" id="status">Waiting for the first tick...</p>
	</main>
	<script src="${scriptUri}"></script>
</body>
</html>`;
}

function activate(context) {
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, new ClockViewProvider(context.extensionUri))
	);
}

module.exports = { activate };
