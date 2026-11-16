import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

interface SnapshotProcess {
	pid: number;
	ppid: number;
	command: string;
	php: boolean;
	cpuMs: number;
}

export interface ProcessDiagnosis {
	php_cpu_busy?: boolean;
	other_php_for_site: number;
}

function cpuTimeMs( value: string ): number {
	const [ , days, hours, minutes, seconds ] =
		value.match( /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/ ) ?? [];
	if ( seconds === undefined ) {
		throw new Error( 'Invalid process CPU time' );
	}
	return (
		( Number( days ?? 0 ) * 86400 +
			Number( hours ?? 0 ) * 3600 +
			Number( minutes ) * 60 +
			Number( seconds ) ) *
		1000
	);
}

export function parseProcessSnapshot( text: string, platform: NodeJS.Platform ): SnapshotProcess[] {
	if ( platform === 'win32' ) {
		const rows = JSON.parse( text.replace( /^\uFEFF/, '' ) );
		return ( Array.isArray( rows ) ? rows : [ rows ] ).map( ( row ) => ( {
			pid: Number( row.ProcessId ),
			ppid: Number( row.ParentProcessId ),
			command: row.CommandLine ?? '',
			php: /^php(?:\.exe)?$/i.test( row.Name ?? '' ),
			// CIM exposes accumulated CPU time in 100-nanosecond units.
			cpuMs: ( Number( row.KernelModeTime ) + Number( row.UserModeTime ) ) / 10000,
		} ) );
	}
	return text
		.split( '\n' )
		.filter( ( line ) => line.trim() )
		.map( ( line ) => {
			const match = line.match( /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/ );
			if ( ! match ) {
				throw new Error( 'Invalid process snapshot' );
			}
			const [ , pid, ppid, time, command ] = match;
			return {
				pid: Number( pid ),
				ppid: Number( ppid ),
				command,
				php:
					/^(?:"[^"\n]*[/\\])?php(?:\.exe)?"?(?:\s|$)/i.test( command ) ||
					/^(?:\S*[/\\])php(?:\.exe)?(?:\s|$)/i.test( command ),
				cpuMs: cpuTimeMs( time ),
			};
		} );
}

function descendants( processes: SnapshotProcess[], rootPid: number ): Set< number > {
	const result = new Set( [ rootPid ] );
	let changed = true;
	while ( changed ) {
		changed = false;
		for ( const proc of processes ) {
			if ( result.has( proc.ppid ) && ! result.has( proc.pid ) ) {
				result.add( proc.pid );
				changed = true;
			}
		}
	}
	result.delete( rootPid );
	return result;
}

export function analyzeProcessSnapshots(
	before: SnapshotProcess[],
	after: SnapshotProcess[],
	rootPid: number,
	sitePath: string,
	platform: NodeJS.Platform
): ProcessDiagnosis {
	const beforeDescendants = descendants( before, rootPid );
	const afterDescendants = descendants( after, rootPid );
	const normalize = ( value: string ) =>
		platform === 'win32' ? value.replace( /\\/g, '/' ).toLowerCase() : value;
	const folder = normalize( sitePath ).replace( /\/+$/, '' );
	const referencesSite = ( command: string ) => {
		const normalized = normalize( command );
		let index = normalized.indexOf( folder );
		while ( index !== -1 ) {
			const preceding = normalized[ index - 1 ];
			const following = normalized[ index + folder.length ];
			if (
				( ! preceding || /[\s"'=]/.test( preceding ) ) &&
				( ! following || /[\s"'/]/.test( following ) )
			) {
				return true;
			}
			index = normalized.indexOf( folder, index + 1 );
		}
		return false;
	};
	const php = after.filter( ( proc ) => proc.php && afterDescendants.has( proc.pid ) );
	const previous = new Map(
		before
			.filter( ( proc ) => proc.php && beforeDescendants.has( proc.pid ) )
			.map( ( proc ) => [ proc.pid, proc ] )
	);
	const cpuMs = php.reduce( ( total, proc ) => {
		const old = previous.get( proc.pid );
		return total + ( old && old.ppid === proc.ppid ? Math.max( 0, proc.cpuMs - old.cpuMs ) : 0 );
	}, 0 );
	// 100 ms over a two-second sample distinguishes sustained work from incidental activity.
	return {
		...( php.length ? { php_cpu_busy: cpuMs >= 100 } : {} ),
		other_php_for_site: after.filter(
			( proc ) =>
				proc.php &&
				proc.pid !== rootPid &&
				! afterDescendants.has( proc.pid ) &&
				referencesSite( proc.command )
		).length,
	};
}

function readSnapshot(): Promise< SnapshotProcess[] > {
	const windows = process.platform === 'win32';
	return new Promise( ( resolve, reject ) => {
		execFile(
			windows ? 'powershell.exe' : 'ps',
			windows
				? [
						'-NoLogo',
						'-NoProfile',
						'-NonInteractive',
						'-Command',
						'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,KernelModeTime,UserModeTime | ConvertTo-Json -Compress',
				  ]
				: [ '-axo', 'pid=,ppid=,time=,command=' ],
			{ timeout: 1200, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
			( error, stdout ) => {
				if ( error ) {
					reject( error );
					return;
				}
				try {
					resolve( parseProcessSnapshot( stdout, process.platform ) );
				} catch ( parseError ) {
					reject( parseError );
				}
			}
		);
	} );
}

// Two bounded reads plus the sample delay leave room within the five-second diagnosis budget.
export async function collectProcessDiagnosis(
	rootPid: number,
	sitePath: string
): Promise< ProcessDiagnosis | undefined > {
	try {
		const before = await readSnapshot();
		await delay( 2000 );
		const after = await readSnapshot();
		return analyzeProcessSnapshots( before, after, rootPid, sitePath, process.platform );
	} catch {
		return undefined;
	}
}
