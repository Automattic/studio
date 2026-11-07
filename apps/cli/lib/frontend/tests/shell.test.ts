import {
	buildShellInvocation,
	getNodeDetectionScript,
	getNodeMajorVersion,
	getUserShell,
	parseNodeDetectionOutput,
	prependToPath,
} from 'cli/lib/frontend/shell';

describe( 'getUserShell', () => {
	it( 'uses $SHELL on POSIX', () => {
		expect( getUserShell( { SHELL: '/opt/homebrew/bin/fish' }, 'darwin' ) ).toBe(
			'/opt/homebrew/bin/fish'
		);
	} );

	it( 'uses ComSpec on Windows', () => {
		expect( getUserShell( { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, 'win32' ) ).toBe(
			'C:\\Windows\\system32\\cmd.exe'
		);
		expect( getUserShell( {}, 'win32' ) ).toBe( 'cmd.exe' );
	} );
} );

describe( 'buildShellInvocation', () => {
	it( 'runs through a login shell on POSIX', () => {
		expect(
			buildShellInvocation( 'npm run dev -- --port 4321', {
				platform: 'darwin',
				shell: '/bin/zsh',
			} )
		).toEqual( { file: '/bin/zsh', args: [ '-lc', 'npm run dev -- --port 4321' ] } );
	} );

	it( 'adds -i for interactive probes', () => {
		expect(
			buildShellInvocation( 'node -v', {
				platform: 'linux',
				shell: '/bin/bash',
				interactive: true,
			} ).args
		).toEqual( [ '-ilc', 'node -v' ] );
	} );

	it( 'runs through cmd.exe on Windows with verbatim arguments', () => {
		expect(
			buildShellInvocation( 'npm run dev', { platform: 'win32', shell: 'cmd.exe' } )
		).toEqual( {
			file: 'cmd.exe',
			args: [ '/d', '/s', '/c', '"npm run dev"' ],
			windowsVerbatimArguments: true,
		} );
	} );
} );

describe( 'parseNodeDetectionOutput', () => {
	const fence = ( body: string ) => {
		const script = getNodeDetectionScript( 'darwin' );
		const [ begin ] = /__STUDIO_NODE_BEGIN__/.exec( script ) ?? [];
		const [ end ] = /__STUDIO_NODE_END__/.exec( script ) ?? [];
		return `${ begin }\n${ body }\n${ end }\n`;
	};

	it( 'reads node, its version and npm', () => {
		expect(
			parseNodeDetectionOutput(
				'Welcome to oh-my-zsh!\n' +
					fence(
						'/Users/me/.nvm/versions/node/v22.11.0/bin/node\nv22.11.0\n/Users/me/.nvm/versions/node/v22.11.0/bin/npm'
					)
			)
		).toEqual( {
			nodePath: '/Users/me/.nvm/versions/node/v22.11.0/bin/node',
			version: 'v22.11.0',
			npmPath: '/Users/me/.nvm/versions/node/v22.11.0/bin/npm',
		} );
	} );

	it( 'reads Windows `where` output', () => {
		expect(
			parseNodeDetectionOutput(
				fence(
					'C:\\Program Files\\nodejs\\node.exe\r\nv20.18.0\r\nC:\\Program Files\\nodejs\\npm.cmd'
				)
			)
		).toEqual( {
			nodePath: 'C:\\Program Files\\nodejs\\node.exe',
			version: 'v20.18.0',
			npmPath: 'C:\\Program Files\\nodejs\\npm.cmd',
		} );
	} );

	it( 'returns undefined when node is missing', () => {
		expect( parseNodeDetectionOutput( fence( '' ) ) ).toBeUndefined();
		expect( parseNodeDetectionOutput( 'no markers at all' ) ).toBeUndefined();
	} );

	it( 'ignores shell aliases and functions that are not paths', () => {
		expect(
			parseNodeDetectionOutput( fence( 'node: aliased to volta run node\nv22.0.0' ) )
		).toBeUndefined();
	} );
} );

describe( 'getNodeMajorVersion', () => {
	it( 'parses the major version', () => {
		expect( getNodeMajorVersion( 'v22.11.0' ) ).toBe( 22 );
		expect( getNodeMajorVersion( '18.0.0' ) ).toBe( 18 );
		expect( getNodeMajorVersion( 'unknown' ) ).toBeUndefined();
	} );
} );

describe( 'prependToPath', () => {
	it( 'prepends a directory once', () => {
		const env = prependToPath( { PATH: '/usr/bin:/bin' }, '/opt/node/bin', 'darwin' );
		expect( env.PATH ).toBe( '/opt/node/bin:/usr/bin:/bin' );
		expect( prependToPath( env, '/opt/node/bin', 'darwin' ) ).toBe( env );
	} );

	it( 'keeps the Windows `Path` key and separator', () => {
		expect(
			prependToPath( { Path: 'C:\\Windows' }, 'C:\\Program Files\\nodejs', 'win32' )
		).toEqual( { Path: 'C:\\Program Files\\nodejs;C:\\Windows' } );
	} );
} );
