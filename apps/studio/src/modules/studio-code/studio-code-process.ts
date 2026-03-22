import { app } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import readline from 'node:readline';
import * as Sentry from '@sentry/electron/main';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import type { StudioCodeCommand, StudioCodeEvent } from './studio-code-types';

class StudioCodeProcess {
	private child: ChildProcess | null = null;
	private siteId: string;
	private sitePath: string;
	private siteName: string;
	private siteUrl: string;

	constructor( siteId: string, sitePath: string, siteName: string, siteUrl: string ) {
		this.siteId = siteId;
		this.sitePath = sitePath;
		this.siteName = siteName;
		this.siteUrl = siteUrl;
	}

	start(): void {
		if ( this.child ) {
			return;
		}

		const nodePath = getBundledNodeBinaryPath();
		const cliPath = getCliPath();

		this.child = spawn(
			nodePath,
			[
				'--experimental-wasm-jspi',
				cliPath,
				'ai',
				'--headless',
				'--site',
				this.sitePath,
				'--site-name',
				this.siteName,
				'--site-url',
				this.siteUrl,
			],
			{
				stdio: [ 'pipe', 'pipe', 'pipe' ],
				env: { ...process.env },
			}
		);

		const rl = readline.createInterface( { input: this.child.stdout! } );
		rl.on( 'line', ( line ) => {
			try {
				const event: StudioCodeEvent = JSON.parse( line );
				void sendIpcEventToRenderer( 'studio-code-event', {
					siteId: this.siteId,
					event,
				} );
			} catch {
				console.warn( `[StudioCode - ${ this.siteId }] Non-JSON stdout line:`, line );
			}
		} );

		this.child.stderr?.on( 'data', ( data: Buffer ) => {
			const text = data.toString().trimEnd();
			if ( text ) {
				console.error( `[StudioCode - ${ this.siteId }] stderr:`, text );
			}
		} );

		this.child.on( 'error', ( error ) => {
			console.error( `[StudioCode - ${ this.siteId }] Process error:`, error );
			Sentry.captureException( error );
		} );

		this.child.on( 'close', ( exitCode, signal ) => {
			console.info(
				`[StudioCode - ${ this.siteId }] Process exited with code ${ exitCode }, signal ${ signal }`
			);
			this.child = null;
			app.off( 'will-quit', this.appQuitHandler );
		} );

		app.on( 'will-quit', this.appQuitHandler );
	}

	send( command: StudioCodeCommand ): void {
		if ( ! this.child?.stdin?.writable ) {
			console.warn(
				`[StudioCode - ${ this.siteId }] Cannot send command: process stdin not writable`
			);
			return;
		}
		this.child.stdin.write( JSON.stringify( command ) + '\n' );
	}

	stop(): void {
		if ( ! this.child ) {
			return;
		}

		app.off( 'will-quit', this.appQuitHandler );

		const pid = this.child.pid;
		this.child.removeAllListeners();
		const result = this.child.kill();
		this.child = null;

		if ( result ) {
			console.info( `[StudioCode - ${ this.siteId }] Killed process with pid ${ pid }` );
		} else {
			console.error(
				`[StudioCode - ${ this.siteId }] Failed to kill process with pid ${ pid }. It may have already terminated.`
			);
		}
	}

	get isRunning(): boolean {
		return this.child !== null;
	}

	private appQuitHandler = () => {
		this.stop();
	};
}

// Module-level process registry
const processes = new Map< string, StudioCodeProcess >();

export function getOrCreateProcess(
	siteId: string,
	sitePath: string,
	siteName: string,
	siteUrl: string
): StudioCodeProcess {
	let proc = processes.get( siteId );
	if ( ! proc || ! proc.isRunning ) {
		proc = new StudioCodeProcess( siteId, sitePath, siteName, siteUrl );
		proc.start();
		processes.set( siteId, proc );
	}
	return proc;
}

export function getProcess( siteId: string ): StudioCodeProcess | undefined {
	return processes.get( siteId );
}

export function stopProcess( siteId: string ): void {
	const proc = processes.get( siteId );
	if ( proc ) {
		proc.stop();
		processes.delete( siteId );
	}
}

export function stopAllProcesses(): void {
	for ( const [ siteId, proc ] of processes ) {
		proc.stop();
		processes.delete( siteId );
	}
}
