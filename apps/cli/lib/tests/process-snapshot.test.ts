import { describe, expect, it } from 'vitest';
import { analyzeProcessSnapshots, parseProcessSnapshot } from '../process-snapshot';

describe( 'process snapshot analysis', () => {
	it.each( [
		[ 2000000, true ],
		[ 0, false ],
	] )( 'samples Windows CPU delta %s', ( delta, busy ) => {
		const fixture = ( cpu: number ) =>
			JSON.stringify( [
				{ ProcessId: 10, ParentProcessId: 1, Name: 'node.exe' },
				{ ProcessId: 11, ParentProcessId: 10, Name: 'cmd.exe' },
				{
					ProcessId: 12,
					ParentProcessId: 11,
					Name: 'php.exe',
					KernelModeTime: 0,
					UserModeTime: cpu,
				},
				{
					ProcessId: 20,
					ParentProcessId: 1,
					Name: 'PHP.EXE',
					CommandLine: 'php.exe "C:\\Sites\\Example\\script.php"',
				},
				{
					ProcessId: 21,
					ParentProcessId: 1,
					Name: 'php.exe',
					CommandLine: 'php.exe C:\\Sites\\Other\\script.php',
				},
				{
					ProcessId: 22,
					ParentProcessId: 1,
					Name: 'php.exe',
					CommandLine: 'php.exe C:\\Sites\\Example-copy\\script.php',
				},
			] );
		expect(
			analyzeProcessSnapshots(
				parseProcessSnapshot( fixture( 10000000 ), 'win32' ),
				parseProcessSnapshot( fixture( 10000000 + Number( delta ) ), 'win32' ),
				10,
				'c:\\sites\\example',
				'win32'
			)
		).toEqual( { php_cpu_busy: busy, other_php_for_site: 1 } );
	} );

	it( 'parses Unix CPU times and counts only unrelated PHP for this folder', () => {
		const fixture = ( time: string ) => `
 10 1 00:00 node server
 11 10 ${ time } /usr/bin/php -S localhost:8080
 20 1 1-02:03:04 php /sites/example/script.php
 21 1 00:00 /usr/bin/php /sites/other/script.php
 22 1 00:00 node /sites/example/script.php
`;
		expect(
			analyzeProcessSnapshots(
				parseProcessSnapshot( fixture( '00:01.00' ), 'linux' ),
				parseProcessSnapshot( fixture( '00:01.20' ), 'linux' ),
				10,
				'/sites/example',
				'linux'
			)
		).toEqual( { php_cpu_busy: true, other_php_for_site: 1 } );
	} );

	it( 'omits CPU activity when there is no PHP descendant', () => {
		const processes = parseProcessSnapshot( '20 1 00:00 php /sites/example/test.php', 'darwin' );
		expect(
			analyzeProcessSnapshots( processes, processes, 10, '/sites/example', 'darwin' )
		).toEqual( { other_php_for_site: 1 } );
	} );
} );
