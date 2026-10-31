/**
 * Facts about the computer the agent's Bash commands run on, read from it the
 * first time they are asked for and the same for the rest of the process, so
 * the system prompt that states them stays the same from turn to turn.
 *
 * Each one is here because the model's commands failed without it: in 927
 * eval runs on macOS, 46 Bash calls wrote GNU sed's `sed -i` against the BSD
 * sed macOS has, and 7 GNU cat's `cat -A`. Whether the tools are GNU's or
 * BSD's is read from the shell pi's Bash tool runs, not from the platform:
 * Windows runs Git Bash, whose tools are GNU's.
 */
import { spawnSync } from 'child_process';
import os from 'os';
import { getShellConfig } from '@earendil-works/pi-coding-agent';

// What a command prints, or undefined when it fails.
function output( command: string, args: string[] ): string | undefined {
	try {
		const result = spawnSync( command, args, {
			encoding: 'utf8',
			timeout: 5000,
			windowsHide: true,
		} );
		return result.status === 0 ? result.stdout.trim() : undefined;
	} catch {
		return undefined;
	}
}

function system(): string {
	if ( process.platform === 'darwin' ) {
		const version = output( 'sw_vers', [ '-productVersion' ] );
		return `macOS${ version ? ` ${ version }` : '' } (${ os.arch() })`;
	}
	if ( process.platform === 'win32' ) {
		return `Windows (${ os.arch() })`;
	}
	return `${ os.type() } (${ os.arch() })`;
}

/** The facts, one line each, as they read for the shell `shell` names. */
export function environmentFactsFor( shell: { shell: string; args: string[] } ): string[] {
	const run = ( script: string ) => output( shell.shell, [ ...shell.args, script ] );
	const bash = run( 'echo "$BASH_VERSION"' )?.match( /^\d+\.\d+/ )?.[ 0 ];
	// GNU sed answers --version; BSD sed has no such option and fails.
	const gnu = /GNU/.test( run( 'sed --version 2>/dev/null' ) ?? '' );
	const shellName = /git[\\/]+(usr[\\/]+)?bin[\\/]+bash/i.test( shell.shell )
		? 'Git Bash'
		: `${ shell.shell }${ bash ? ` ${ bash }` : '' }`;
	return [
		`This computer runs ${ system() }. Bash commands run in ${ shellName }, with the ${
			gnu
				? 'GNU versions of sed, grep and cat'
				: "BSD versions of sed, grep and cat: `sed -i` takes a backup suffix (`sed -i ''` for none)"
		}.`,
	];
}

let facts: string[] | undefined;

/** The facts about this computer, for the shell pi's Bash tool runs. */
export function environmentFacts(): string[] {
	if ( ! facts ) {
		try {
			facts = environmentFactsFor( getShellConfig() );
		} catch {
			facts = [ `This computer runs ${ system() }.` ];
		}
	}
	return facts;
}
