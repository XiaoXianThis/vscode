/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Fork contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

(function () {

	const vscode = acquireVsCodeApi();

	const note = document.getElementById('note');
	const summary = document.getElementById('summary');

	// Restore what was typed before this view was torn down. The webview is disposed whenever
	// another plugin is selected, so this is what makes the note feel persistent.
	const previous = vscode.getState();
	if (previous && typeof previous.text === 'string') {
		note.value = previous.text;
	}

	let debounce;

	function report() {
		const text = note.value;
		vscode.setState({ text });
		clearTimeout(debounce);
		debounce = setTimeout(() => vscode.postMessage({ type: 'change', text }), 150);
	}

	note.addEventListener('input', report);

	window.addEventListener('message', event => {
		const message = event.data;
		if (!message || message.type !== 'summary') {
			return;
		}
		const words = message.words === 1 ? '1 word' : `${message.words} words`;
		const characters = message.characters === 1 ? '1 character' : `${message.characters} characters`;
		summary.textContent = `${words}, ${characters}`;
	});

	// Send whatever was restored so the summary matches the visible text on first paint.
	report();
}());
