import { parse } from 'shell-quote';

const PLACEHOLDER_CHAR_BEGIN = [ '<', '[', '{', '(' ];

export function useIsValidWpCliInline( command: string ) {
	const wpCliArgs = parse( command )
		.map( ( arg ) => {
			if ( typeof arg === 'string' || arg instanceof String ) {
				return arg;
			} else if ( 'op' in arg ) {
				return arg.op;
			} else {
				return false;
			}
		} )
		.filter( Boolean ) as string[];
	const wpCommandCount = wpCliArgs.filter( ( arg ) => arg === 'wp' ).length;
	const containsPath = wpCliArgs.some(
		( arg ) => /path/i.test( arg[ 0 ] ) || /\//.test( arg[ 0 ] )
	);
	const containsPlaceholderArgs = wpCliArgs.some( ( arg ) =>
		PLACEHOLDER_CHAR_BEGIN.includes( arg[ 0 ] )
	);
	const isValidWpCliCommand =
		wpCliArgs.length > 0 &&
		wpCliArgs[ 0 ] === 'wp' &&
		wpCommandCount === 1 &&
		! containsPath &&
		! containsPlaceholderArgs;

	return isValidWpCliCommand;
}
