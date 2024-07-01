import { parse } from 'shell-quote';

const PLACEHOLDER_CHAR_BEGIN = [ '<', '[', '{', '(' ];
const UNSUPPORTED_COMMANDS = [ 'db', 'server', 'shell' ];

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
	console.log( 'wpCliArgs', wpCliArgs );
	const wpCommandCount = wpCliArgs.filter( ( arg ) => arg === 'wp' ).length;
	const containsPath = wpCliArgs.some( ( arg ) => /path/i.test( arg ) || arg.startsWith( '/' ) );
	const containsPlaceholderArgs = wpCliArgs.some( ( arg ) =>
		PLACEHOLDER_CHAR_BEGIN.includes( arg[ 0 ] )
	);
	const containsUnsupportedCommand = UNSUPPORTED_COMMANDS.includes( wpCliArgs[ 1 ] );

	return (
		wpCliArgs.length > 0 &&
		wpCliArgs[ 0 ] === 'wp' &&
		wpCommandCount === 1 &&
		! containsPath &&
		! containsPlaceholderArgs &&
		! containsUnsupportedCommand
	);
}
