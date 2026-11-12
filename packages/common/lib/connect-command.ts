import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	getConnection,
	InvalidCredentialError,
	type CommandSignIn,
	type ConnectCommand,
	type ProviderId,
} from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { AGENT_APP_NAMES, isAgentAppId } from './agent-apps';
import { findAgentAppCli } from './connect-agent-app';

const START_TIMEOUT_MS = 30_000;
const FINISH_TIMEOUT_MS = 60_000;
// Long enough to approve in the browser.
const SESSION_TIMEOUT_MS = 10 * 60_000;
const EXIT_MARKER = '__STUDIO_SIGN_IN_EXIT__';

interface Session {
	provider: ProviderId;
	run: ConnectCommand;
	child: ChildProcessWithoutNullStreams;
	output: string;
	exited: boolean;
	listeners: Set< () => void >;
}

const sessions = new Map< string, Session >();

const quote = ( value: string ) => `'${ value.replace( /'/g, `'\\''` ) }'`;

// Sign-in commands such as Claude Code's draw a terminal UI, so they need a
// terminal: `script` gives them one, wide enough that nothing wraps. macOS's
// `script` refuses a socket for stdin, so the input goes through `cat`.
function spawnInTerminal( file: string, args: string[] ): ChildProcessWithoutNullStreams {
	if ( process.platform === 'win32' ) {
		throw new InvalidCredentialError(
			__( 'Studio can’t run the sign-in on Windows yet. Paste a token instead.' )
		);
	}
	const command = `stty cols 1000 rows 50; ${ [ file, ...args ]
		.map( quote )
		.join( ' ' ) }; echo ${ EXIT_MARKER }`;
	const terminal =
		process.platform === 'darwin'
			? `script -q /dev/null sh -c ${ quote( command ) }`
			: `script -qfec ${ quote( command ) } /dev/null`;
	return spawn( 'sh', [ '-c', `cat | ${ terminal }` ], { detached: true } );
}

// What the command printed, without its colors, cursor moves and links.
function plainText( output: string ): string {
	return (
		output
			// eslint-disable-next-line no-control-regex
			.replace( /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '' )
			// eslint-disable-next-line no-control-regex
			.replace( /\u001b\[[0-?]*[ -/]*[@-~]/g, '' )
	);
}

function findUrl( output: string ): string | undefined {
	// eslint-disable-next-line no-control-regex
	const link = /\u001b\]8;[^;]*;(https:\/\/[^\u0007\u001b]+)/.exec( output )?.[ 1 ];
	return link ?? /https:\/\/\S+/.exec( plainText( output ) )?.[ 0 ];
}

function stop( id: string ) {
	const session = sessions.get( id );
	sessions.delete( id );
	if ( session?.child.pid ) {
		try {
			process.kill( -session.child.pid );
		} catch {
			// Already gone.
		}
	}
}

// Resolves with what `read` finds in the output, once it finds something.
function waitFor< T >(
	session: Session,
	read: ( output: string ) => T | undefined,
	timeout: number
): Promise< T > {
	return new Promise( ( resolve, reject ) => {
		const check = () => {
			const found = read( session.output );
			if ( found !== undefined ) {
				done();
				resolve( found );
			} else if ( session.exited ) {
				done();
				const lines = plainText( session.output )
					.replace( EXIT_MARKER, '' )
					.split( /\r?\n/ )
					.map( ( line ) => line.trim() )
					.filter( Boolean );
				reject(
					new InvalidCredentialError( lines.at( -1 ) ?? __( 'The sign-in stopped. Try again.' ) )
				);
			}
		};
		const timer = setTimeout( () => {
			done();
			reject( new InvalidCredentialError( __( 'The sign-in took too long. Try again.' ) ) );
		}, timeout );
		const done = () => {
			clearTimeout( timer );
			session.listeners.delete( check );
		};
		session.listeners.add( check );
		check();
	} );
}

/**
 * Runs a form's sign-in command (`run`), which opens the browser, and resolves
 * once it waits for the code shown there. Starting again stops the
 * provider's previous run.
 */
export async function startCommandSignIn(
	provider: ProviderId,
	method?: string
): Promise< CommandSignIn > {
	const connection = getConnection( provider, method );
	const run = connection.kind === 'form' ? connection.run : undefined;
	if ( ! run ) {
		throw new Error( `${ provider } has no sign-in command` );
	}
	const file = await findAgentAppCli( run.app );
	if ( ! file ) {
		throw new InvalidCredentialError(
			sprintf(
				/* translators: %s: an app's name, such as Claude Code */
				__( 'Install %s first.' ),
				isAgentAppId( run.app ) ? AGENT_APP_NAMES[ run.app ] : run.app
			)
		);
	}
	for ( const [ id, session ] of sessions ) {
		if ( session.provider === provider ) {
			stop( id );
		}
	}
	const id = randomUUID();
	const session: Session = {
		provider,
		run,
		child: spawnInTerminal( file, run.args ),
		output: '',
		exited: false,
		listeners: new Set(),
	};
	const changed = () => session.listeners.forEach( ( listener ) => listener() );
	session.child.stdout.on( 'data', ( chunk ) => {
		session.output += chunk;
		session.exited ||= session.output.includes( EXIT_MARKER );
		changed();
	} );
	session.child.on( 'exit', () => {
		session.exited = true;
		changed();
	} );
	sessions.set( id, session );
	setTimeout( () => stop( id ), SESSION_TIMEOUT_MS ).unref();
	try {
		return { id, url: await waitFor( session, findUrl, START_TIMEOUT_MS ) };
	} catch ( error ) {
		stop( id );
		throw error;
	}
}

// Sends the code from the browser, and resolves with the form value the command prints.
export async function finishCommandSignIn(
	id: string,
	code: string
): Promise< Record< string, string > > {
	const session = sessions.get( id );
	if ( ! session ) {
		throw new InvalidCredentialError( __( 'The sign-in expired. Start again.' ) );
	}
	session.child.stdin.write( `${ code.trim() }\r` );
	try {
		const value = await waitFor(
			session,
			( output ) => session.run.pattern.exec( plainText( output ) )?.[ 1 ],
			FINISH_TIMEOUT_MS
		);
		return { [ session.run.fills ]: value };
	} finally {
		stop( id );
	}
}
