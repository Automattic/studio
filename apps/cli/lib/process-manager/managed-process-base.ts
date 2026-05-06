import { createWriteStream, WriteStream } from 'fs';
import path from 'path';
import readline from 'readline';
import { PROCESS_MANAGER_LOGS_DIR } from 'cli/lib/paths';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import {
	ManagedProcess,
	ManagedProcessCallbacks,
	ManagedProcessEvent,
	ManagedProcessStatus,
} from './managed-process';

const STDERR_BUFFER_MAX_LINES = 100;
const STDERR_BUFFER_MAX_BYTES = 16 * 1024;

function formatLogDateTag( date: Date ): string {
	const year = date.getFullYear();
	const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
	const day = String( date.getDate() ).padStart( 2, '0' );
	return `${ year }${ month }${ day }`;
}

function getProcessLogPaths( processName: string, date: Date = new Date() ) {
	const dateTag = formatLogDateTag( date );
	return {
		stdoutLogPath: path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-out-${ dateTag }.log` ),
		stderrLogPath: path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-error-${ dateTag }.log` ),
	};
}

export function timestampLogLine( line: string ): string {
	return `${ new Date().toISOString() } ${ line }\n`;
}

export abstract class ManagedProcessBase implements ManagedProcess {
	readonly stdoutLogPath: string;
	readonly stderrLogPath: string;

	protected readonly stdoutStream: WriteStream;
	protected readonly stderrStream: WriteStream;
	protected settled = false;
	protected stderrBuffer: string[] = [];
	protected stderrBufferBytes = 0;
	protected currentPid?: number;
	protected currentStatus: ManagedProcessStatus = 'stopped';

	constructor(
		readonly pmId: number,
		readonly name: string,
		protected readonly callbacks: ManagedProcessCallbacks
	) {
		const { stdoutLogPath, stderrLogPath } = getProcessLogPaths( name );
		this.stdoutLogPath = stdoutLogPath;
		this.stderrLogPath = stderrLogPath;
		this.stdoutStream = createWriteStream( stdoutLogPath, { flags: 'a' } );
		this.stderrStream = createWriteStream( stderrLogPath, { flags: 'a' } );
	}

	get status(): ManagedProcessStatus {
		return this.currentStatus;
	}

	get pid(): number | undefined {
		return this.currentPid;
	}

	abstract start(): Promise< void >;
	abstract stop(): Promise< void >;
	abstract forceStop(): Promise< void > | void;
	abstract sendMessage(
		message: Parameters< ManagedProcess[ 'sendMessage' ] >[ 0 ]
	): Promise< void >;

	toProcessDescription(): ProcessDescription {
		if ( this.status === 'stopped' ) {
			return {
				name: this.name,
				pmId: this.pmId,
				status: this.status,
			};
		}

		return {
			name: this.name,
			pmId: this.pmId,
			status: this.status,
			pid: this.pid ?? process.pid,
		};
	}

	protected async emitEvent( event: ManagedProcessEvent ): Promise< void > {
		await this.callbacks.onEvent( this, event );
	}

	protected async emitMessage( raw: unknown ): Promise< void > {
		await this.callbacks.onMessage( this, raw );
	}

	protected writeStdoutLine( line: string ): void {
		this.stdoutStream.write( timestampLogLine( line ) );
	}

	protected writeStderrLine( line: string ): void {
		this.stderrStream.write( timestampLogLine( line ) );
		this.recordStderrLine( line );
	}

	protected writeStderrText( content: string ): void {
		const normalizedContent = content.split( '\r\n' ).join( '\n' );
		const lines = normalizedContent.trimEnd().split( '\n' );

		lines.forEach( ( line ) => {
			this.writeStderrLine( line );
		} );
	}

	protected pipeOutputWithTimestamp(
		input: NodeJS.ReadableStream | null,
		onLine: ( line: string ) => void
	): void {
		if ( ! input ) {
			return;
		}

		const lineReader = readline.createInterface( {
			input,
			crlfDelay: Infinity,
		} );

		lineReader.on( 'line', onLine );
	}

	protected async settleAndEmitExit(): Promise< void > {
		if ( this.settled ) {
			return;
		}

		this.settled = true;
		this.currentStatus = 'stopped';
		this.stdoutStream.end();
		this.stderrStream.end();

		const stderrTail = this.stderrBuffer.join( '\n' );
		await this.emitEvent( {
			event: 'exit',
			...( stderrTail ? { stderrTail } : {} ),
		} );
		await this.callbacks.onExit( this );
	}

	private recordStderrLine( line: string ): void {
		this.stderrBuffer.push( line );
		this.stderrBufferBytes += Buffer.byteLength( line, 'utf8' ) + 1;

		while (
			this.stderrBuffer.length > STDERR_BUFFER_MAX_LINES ||
			this.stderrBufferBytes > STDERR_BUFFER_MAX_BYTES
		) {
			const dropped = this.stderrBuffer.shift();
			if ( dropped === undefined ) {
				break;
			}
			this.stderrBufferBytes -= Buffer.byteLength( dropped, 'utf8' ) + 1;
		}
	}
}
