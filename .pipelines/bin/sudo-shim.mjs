// What `@vscode/sudo-prompt` resolves to in the Node processes `env.mjs` runs as an agent (see
// `agent-hooks.mjs`): every request for administrator rights fails as when the owner declines the
// password dialog, which never shows. It logs each one to `$RP_STUDIO_SUDO_LOG`.
import fs from 'node:fs';

function exec( command, options, callback ) {
	const done = typeof options === 'function' ? options : callback;
	if ( process.env.RP_STUDIO_SUDO_LOG ) {
		try {
			fs.appendFileSync(
				process.env.RP_STUDIO_SUDO_LOG,
				`${ new Date().toISOString() } refused: ${ command }\n`
			);
		} catch {}
	}
	process.nextTick( () => done?.( new Error( 'User did not grant permission.' ) ) );
}

// Tells a check that this is the shim, not `@vscode/sudo-prompt`.
export const isSudoShim = true;
export { exec };
export default { exec, isSudoShim };
