/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Fork contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

(function () {

	const vscode = acquireVsCodeApi();

	const clock = document.getElementById('clock');
	const zone = document.getElementById('zone');
	const status = document.getElementById('status');

	let ticks = 0;

	window.addEventListener('message', event => {
		const message = event.data;
		if (!message || message.type !== 'tick') {
			return;
		}

		clock.textContent = new Date(message.epochMs).toLocaleTimeString(undefined, { hour12: false });
		zone.textContent = message.timeZone;

		ticks += 1;
		status.textContent = `${ticks} tick${ticks === 1 ? '' : 's'} received`;
	});

	// Ask for the first value: a message the extension posts before this script has run is
	// dropped, so the extension waits for this instead of pushing on resolve.
	vscode.postMessage({ type: 'ready' });
}());
