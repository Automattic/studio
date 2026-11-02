// `wp` in the agent's shell: node wp-cli-client.mjs <server> <cli> <wp arguments>.
//
// Asks the agent's process, at <server>, for the PHP process `studio wp` would
// run for these arguments in this folder with this environment, and runs it
// with the shell's stdin and output, returning its exit code. Without an
// answer (the server is gone), runs `studio wp` through the CLI at <cli>.
import { spawn } from 'node:child_process';
import net from 'node:net';

const [ server, cli, ...argv ] = process.argv.slice( 2 );

function run( command, args, options ) {
	const child = spawn( command, args, { stdio: 'inherit', ...options } );
	for ( const signal of [ 'SIGINT', 'SIGTERM', 'SIGHUP' ] ) {
		process.on( signal, () => child.kill( signal ) );
	}
	child.on( 'error', ( error ) => {
		process.stderr.write( `${ error.message }\n` );
		process.exit( 1 );
	} );
	child.on( 'exit', ( code, signal ) => process.exit( code ?? ( signal ? 128 : 1 ) ) );
}

function studioWp() {
	run( process.execPath, [ cli, 'wp', ...argv, '--avoid-telemetry' ] );
}

let answer = '';
const socket = net.connect( server );
socket.setEncoding( 'utf8' );
socket.on( 'connect', () =>
	socket.write( `${ JSON.stringify( { cwd: process.cwd(), argv, env: process.env } ) }\n` )
);
socket.on( 'error', () => {} );
socket.on( 'close', () => answer.includes( '\n' ) || studioWp() );
socket.on( 'data', ( chunk ) => {
	answer += chunk;
	if ( ! answer.includes( '\n' ) ) {
		return;
	}
	socket.destroy();
	const reply = JSON.parse( answer );
	if ( reply.error ) {
		process.stderr.write( `${ reply.error }\n` );
		process.exit( 1 );
	}
	run( reply.command, reply.args, { cwd: reply.cwd, env: reply.env } );
} );
