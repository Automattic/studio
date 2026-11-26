import { describe, expect, it } from 'vitest';
import { analyzeStalledPhp, type WindowsProcess } from '../stalled-php';

const proc = (
	ProcessId: number,
	ParentProcessId: number,
	Name: string,
	CommandLine: string | null = null,
	UserModeTime = 0
): WindowsProcess => ( {
	ProcessId,
	ParentProcessId,
	Name,
	CommandLine,
	KernelModeTime: 0,
	UserModeTime,
} );

// Server child 10 runs a worker through cmd.exe; 20 is a leftover PHP for the same site,
// 21 and 22 are PHP for other sites, one with a name that shares the folder's prefix.
const processes = ( workerCpu: number ) => [
	proc( 10, 1, 'node.exe' ),
	proc( 11, 10, 'cmd.exe' ),
	proc( 12, 11, 'php.exe', 'php.exe -S localhost:8881', workerCpu ),
	proc( 20, 1, 'PHP.EXE', 'php.exe -S 127.0.0.1:9990 -t "C:/Users/me/Studio/Site"' ),
	proc( 21, 1, 'php.exe', 'php.exe C:\\Users\\me\\Studio\\Other\\index.php' ),
	proc( 22, 1, 'php.exe', 'php.exe C:\\Users\\me\\Studio\\Site-copy\\index.php' ),
];

describe( 'analyzeStalledPhp', () => {
	it.each( [
		[ 'busy', 2_000_000, true ],
		[ 'idle', 0, false ],
	] )( 'reports a %s worker and counts leftover PHP for the site', ( _, delta, busy ) => {
		expect(
			analyzeStalledPhp(
				processes( 10_000_000 ),
				processes( 10_000_000 + delta ),
				10,
				'C:\\Users\\me\\Studio\\site\\'
			)
		).toEqual( { php_cpu_busy: busy, other_php_for_site: 1 } );
	} );

	it( 'omits CPU activity when the server has no PHP', () => {
		const list = processes( 0 ).filter( ( { ProcessId } ) => ProcessId !== 12 );
		expect( analyzeStalledPhp( list, list, 10, 'C:\\Users\\me\\Studio\\Site' ) ).toEqual( {
			other_php_for_site: 1,
		} );
	} );
} );
