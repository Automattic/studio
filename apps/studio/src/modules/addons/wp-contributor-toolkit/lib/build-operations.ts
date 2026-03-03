/**
 * Build operations for the WordPress Contributor Toolkit addon.
 * Runs npm commands from system PATH via child_process.
 */
import { execFile, spawn } from 'node:child_process';
import type { BuildStatus } from '../types';
import type { ChildProcess } from 'node:child_process';

const watchProcesses = new Map< string, ChildProcess >();

export async function isNpmAvailable(): Promise< boolean > {
	return new Promise( ( resolve ) => {
		execFile( 'npm', [ '--version' ], ( error ) => {
			resolve( ! error );
		} );
	} );
}

export function runNpmInstall(
	repoPath: string,
	onLog: ( line: string ) => void,
	onDone: ( success: boolean ) => void
): void {
	const proc = spawn( 'npm', [ 'install' ], {
		cwd: repoPath,
		stdio: 'pipe',
		shell: false,
	} );

	const handleData = ( data: Buffer ) => {
		const text = data.toString();
		const lines = text.split( '\n' );
		for ( const line of lines ) {
			if ( line.trim() ) {
				onLog( line );
			}
		}
	};

	proc.stdout.on( 'data', handleData );
	proc.stderr.on( 'data', handleData );

	proc.on( 'close', ( code ) => {
		onDone( code === 0 );
	} );

	proc.on( 'error', ( err ) => {
		onLog( `Error: ${ err.message }` );
		onDone( false );
	} );
}

export function runBuild(
	repoPath: string,
	onLog: ( line: string ) => void,
	onDone: ( success: boolean ) => void
): void {
	const proc = spawn( 'npm', [ 'run', 'build' ], {
		cwd: repoPath,
		stdio: 'pipe',
		shell: false,
	} );

	const handleData = ( data: Buffer ) => {
		const text = data.toString();
		const lines = text.split( '\n' );
		for ( const line of lines ) {
			if ( line.trim() ) {
				onLog( line );
			}
		}
	};

	proc.stdout.on( 'data', handleData );
	proc.stderr.on( 'data', handleData );

	proc.on( 'close', ( code ) => {
		onDone( code === 0 );
	} );

	proc.on( 'error', ( err ) => {
		onLog( `Error: ${ err.message }` );
		onDone( false );
	} );
}

export function startWatch(
	siteId: string,
	repoPath: string,
	onLog: ( line: string ) => void,
	onStatus: ( status: BuildStatus ) => void
): void {
	const existing = watchProcesses.get( siteId );
	if ( existing ) {
		stopWatch( siteId );
	}

	onStatus( 'running' );

	const proc = spawn( 'npm', [ 'run', 'dev' ], {
		cwd: repoPath,
		stdio: 'pipe',
		shell: false,
	} );

	watchProcesses.set( siteId, proc );

	const handleData = ( data: Buffer ) => {
		const text = data.toString();
		const lines = text.split( '\n' );
		for ( const line of lines ) {
			if ( line.trim() ) {
				onLog( line );
			}
		}
	};

	proc.stdout?.on( 'data', handleData );
	proc.stderr?.on( 'data', handleData );

	proc.on( 'close', ( code ) => {
		watchProcesses.delete( siteId );
		onStatus( code === 0 || code === null ? 'idle' : 'error' );
	} );

	proc.on( 'error', ( err ) => {
		onLog( `Error: ${ err.message }` );
		watchProcesses.delete( siteId );
		onStatus( 'error' );
	} );
}

export function stopWatch( siteId: string ): void {
	const proc = watchProcesses.get( siteId );
	if ( proc ) {
		proc.kill();
		watchProcesses.delete( siteId );
	}
}

export function stopAllWatches(): void {
	for ( const [ siteId ] of watchProcesses ) {
		stopWatch( siteId );
	}
}
