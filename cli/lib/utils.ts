import os from 'node:os';

export function normalizeHostname( hostname: string ): string {
	return hostname
		.trim()
		.toLowerCase()
		.replace( /^https?:\/\//, '' )
		.replace( /\/$/, '' );
}

export function getColumnWidths( widthFactors: number[] ) {
	const padding = widthFactors.length * 2;
	const columns = Math.min( process.stdout.columns || 80, 140 ) - padding;
	return widthFactors.map( ( widthFactor ) => Math.round( widthFactor * columns ) );
}

export function getPrettyPath( path: string ): string {
	return process.platform === 'win32'
		? path
		: path.replace( process.cwd(), '.' ).replace( os.homedir(), '~' );
}

// `~` is a shell construct on Posix platforms. The shell expands it to the user's home directory
// if it's at the beginning of a word, like this: `--path ~/test`. If users specify an option like
// this: `--path=~/test`, then it's not expanded, and we need to do it in code.
export function untildify( path: string ): string {
	return process.platform === 'win32' ? path : path.replace( /^~/, os.homedir() );
}
