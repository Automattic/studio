import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface WindowsProcess {
	ProcessId: number;
	ParentProcessId: number;
	Name: string;
	CommandLine: string | null;
	// Accumulated CPU time, in 100-nanosecond units.
	KernelModeTime: number;
	UserModeTime: number;
}

export interface StalledPhpDiagnosis {
	php_cpu_busy?: boolean;
	other_php_for_site: number;
}

// 100 ms of CPU over the two-second sample separates sustained work from incidental activity.
const BUSY_CPU_MS = 100;

const isPhp = ( proc: WindowsProcess ) => /^php(\.exe)?$/i.test( proc.Name );
const cpuMs = ( proc: WindowsProcess ) => ( proc.KernelModeTime + proc.UserModeTime ) / 10_000;

export function analyzeStalledPhp(
	before: WindowsProcess[],
	after: WindowsProcess[],
	serverPid: number,
	sitePath: string
): StalledPhpDiagnosis {
	const tree = new Set( [ serverPid ] );
	for ( let grew = true; grew;  ) {
		grew = false;
		for ( const proc of after ) {
			if ( tree.has( proc.ParentProcessId ) && ! tree.has( proc.ProcessId ) ) {
				tree.add( proc.ProcessId );
				grew = true;
			}
		}
	}
	const sitePhp = after.filter( ( proc ) => isPhp( proc ) && tree.has( proc.ProcessId ) );
	const busyMs = sitePhp.reduce( ( total, proc ) => {
		const earlier = before.find( ( { ProcessId } ) => ProcessId === proc.ProcessId );
		return total + ( earlier ? cpuMs( proc ) - cpuMs( earlier ) : 0 );
	}, 0 );
	const folder = sitePath.replace( /[\\/]+$/, '' ).toLowerCase();
	// Matches the folder itself or a path inside it, not a sibling that shares its name as a prefix.
	const referencesSite = ( commandLine: string | null ) => {
		const normalized =
			( commandLine ?? '' ).replace( /\//g, '\\' ).replace( /["']/g, ' ' ).toLowerCase() + ' ';
		return normalized.includes( folder + '\\' ) || normalized.includes( folder + ' ' );
	};
	const otherPhp = after.filter(
		( proc ) => isPhp( proc ) && ! tree.has( proc.ProcessId ) && referencesSite( proc.CommandLine )
	);
	return {
		...( sitePhp.length ? { php_cpu_busy: busyMs >= BUSY_CPU_MS } : {} ),
		other_php_for_site: otherPhp.length,
	};
}

// One PowerShell call takes both samples, because PowerShell alone can take seconds to start. With
// PHP spinning on every core the whole call took up to 9 s on a 4-core VM, hence the 20 s limit.
const SAMPLE_SCRIPT = `
$fields = 'ProcessId','ParentProcessId','Name','CommandLine','KernelModeTime','UserModeTime'
$before = @(Get-CimInstance Win32_Process | Select-Object $fields)
Start-Sleep -Seconds 2
$after = @(Get-CimInstance Win32_Process | Select-Object $fields)
ConvertTo-Json -Compress -Depth 3 @{ before = $before; after = $after }
`;

/**
 * Samples the PHP processes of a start that timed out. Best effort: returns undefined on any error.
 */
export async function diagnoseStalledPhp(
	serverPid: number,
	sitePath: string
): Promise< StalledPhpDiagnosis | undefined > {
	try {
		const { stdout } = await promisify( execFile )(
			'powershell.exe',
			[ '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SAMPLE_SCRIPT ],
			{ timeout: 20_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }
		);
		const { before, after } = JSON.parse( stdout );
		return analyzeStalledPhp( before, after, serverPid, sitePath );
	} catch {
		return undefined;
	}
}
