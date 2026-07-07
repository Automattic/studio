import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSshSiteTools } from 'cli/ai/tools/ssh-site-tools';
import { execSsh, type SshConnection, type SshExecResult } from 'cli/lib/ssh';

vi.mock( 'cli/lib/ssh', async ( importOriginal ) => {
	const original = await importOriginal< typeof import('cli/lib/ssh') >();
	return { ...original, execSsh: vi.fn() };
} );

const execSshMock = vi.mocked( execSsh );

const connection: SshConnection = {
	destination: 'deploy@example.com',
	remotePath: '/var/www/html',
};

function mockResult( result: Partial< SshExecResult > ): void {
	execSshMock.mockResolvedValueOnce( { stdout: '', stderr: '', exitCode: 0, ...result } );
}

function getTool( name: string ) {
	const tool = createSshSiteTools( connection ).find( ( t ) => t.name === name );
	if ( ! tool ) {
		throw new Error( `Tool ${ name } not found` );
	}
	return tool;
}

function lastRemoteCommand(): string {
	const call = execSshMock.mock.calls[ execSshMock.mock.calls.length - 1 ];
	return call[ 1 ];
}

beforeEach( () => {
	execSshMock.mockReset();
} );

describe( 'ssh Read tool', () => {
	it( 'cats the file relative to the WordPress root', async () => {
		mockResult( { stdout: 'file content' } );
		const result = await getTool( 'Read' ).rawHandler( {
			path: 'wp-content/themes/x/style.css',
		} as never );
		expect( lastRemoteCommand() ).toBe(
			`cd '/var/www/html' && cat -- 'wp-content/themes/x/style.css'`
		);
		expect( result.content[ 0 ] ).toEqual( { type: 'text', text: 'file content' } );
	} );

	it( 'rejects paths escaping the WordPress root without running ssh', async () => {
		await expect(
			getTool( 'Read' ).rawHandler( { path: '../../etc/passwd' } as never )
		).rejects.toThrow( /must be relative/ );
		expect( execSshMock ).not.toHaveBeenCalled();
	} );
} );

describe( 'ssh Write tool', () => {
	it( 'creates parent directories and pipes content over stdin', async () => {
		mockResult( {} );
		await getTool( 'Write' ).rawHandler( {
			path: 'wp-content/studio-tmp/page.html',
			content: '<!-- wp:paragraph --><p>Hi</p>',
		} as never );
		expect( lastRemoteCommand() ).toBe(
			`cd '/var/www/html' && mkdir -p -- 'wp-content/studio-tmp' && cat > 'wp-content/studio-tmp/page.html'`
		);
		expect( execSshMock.mock.calls[ 0 ][ 2 ] ).toMatchObject( {
			stdin: '<!-- wp:paragraph --><p>Hi</p>',
		} );
	} );
} );

describe( 'ssh Edit tool', () => {
	it( 'replaces a unique occurrence and writes the file back', async () => {
		mockResult( { stdout: 'color: red;\nbackground: blue;' } );
		mockResult( {} );
		await getTool( 'Edit' ).rawHandler( {
			path: 'wp-content/themes/x/style.css',
			old_string: 'color: red;',
			new_string: 'color: green;',
		} as never );
		expect( execSshMock ).toHaveBeenCalledTimes( 2 );
		expect( execSshMock.mock.calls[ 1 ][ 2 ] ).toMatchObject( {
			stdin: 'color: green;\nbackground: blue;',
		} );
	} );

	it( 'fails when old_string is ambiguous and replace_all is not set', async () => {
		mockResult( { stdout: 'a a' } );
		await expect(
			getTool( 'Edit' ).rawHandler( {
				path: 'file.txt',
				old_string: 'a',
				new_string: 'b',
			} as never )
		).rejects.toThrow( /occurs 2 times/ );
		expect( execSshMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'fails when old_string is missing', async () => {
		mockResult( { stdout: 'nothing here' } );
		await expect(
			getTool( 'Edit' ).rawHandler( {
				path: 'file.txt',
				old_string: 'absent',
				new_string: 'b',
			} as never )
		).rejects.toThrow( /not found/ );
	} );
} );

describe( 'ssh Grep tool', () => {
	it( 'searches with quoted pattern and include glob', async () => {
		mockResult( { stdout: 'wp-content/themes/x/style.css:3:color: red;' } );
		const result = await getTool( 'Grep' ).rawHandler( {
			pattern: 'color: red;',
			path: 'wp-content/themes',
			include: '*.css',
		} as never );
		expect( lastRemoteCommand() ).toBe(
			`cd '/var/www/html' && grep -rn -I -E --include='*.css' -e 'color: red;' -- 'wp-content/themes' | head -n 500`
		);
		expect( result.content[ 0 ] ).toMatchObject( {
			text: expect.stringContaining( 'style.css:3' ),
		} );
	} );

	it( 'reports no matches instead of failing', async () => {
		mockResult( {} );
		const result = await getTool( 'Grep' ).rawHandler( { pattern: 'nope' } as never );
		expect( result.content[ 0 ] ).toEqual( { type: 'text', text: 'No matches found.' } );
	} );

	it( 'surfaces remote errors from stderr', async () => {
		mockResult( { stderr: 'grep: unrecognized option' } );
		await expect( getTool( 'Grep' ).rawHandler( { pattern: 'x' } as never ) ).rejects.toThrow(
			/unrecognized option/
		);
	} );
} );

describe( 'ssh Glob tool', () => {
	it( 'uses -name for bare patterns', async () => {
		mockResult( { stdout: './wp-content/x.css' } );
		await getTool( 'Glob' ).rawHandler( { pattern: '*.css' } as never );
		expect( lastRemoteCommand() ).toBe(
			`cd '/var/www/html' && find '.' -type f -name '*.css' | head -n 500`
		);
	} );

	it( 'anchors path patterns at the search base', async () => {
		mockResult( { stdout: '' } );
		await getTool( 'Glob' ).rawHandler( {
			pattern: 'wp-content/themes/**/functions.php',
		} as never );
		expect( lastRemoteCommand() ).toBe(
			`cd '/var/www/html' && find '.' -type f -path './wp-content/themes/*/functions.php' | head -n 500`
		);
	} );
} );

describe( 'ssh wp_cli tool', () => {
	it( 'quotes every argument literally', async () => {
		mockResult( { stdout: 'Success: Updated.' } );
		const result = await getTool( 'wp_cli' ).rawHandler( {
			command: 'option update blogname "Ember & Oak"',
		} as never );
		expect( lastRemoteCommand() ).toBe(
			`cd '/var/www/html' && 'wp' 'option' 'update' 'blogname' 'Ember & Oak'`
		);
		expect( result.content[ 0 ] ).toEqual( { type: 'text', text: 'Success: Updated.' } );
	} );

	it( 'uses the configured WP-CLI path', async () => {
		mockResult( { stdout: 'ok' } );
		const tool = createSshSiteTools( { ...connection, wpCliPath: '/usr/local/bin/wp' } ).find(
			( t ) => t.name === 'wp_cli'
		);
		await tool!.rawHandler( { command: 'core version' } as never );
		expect( lastRemoteCommand() ).toContain( `'/usr/local/bin/wp' 'core' 'version'` );
	} );

	it( 'rejects typographic dashes before running ssh', async () => {
		await expect(
			getTool( 'wp_cli' ).rawHandler( { command: 'plugin list –status=active' } as never )
		).rejects.toThrow( /ASCII hyphens/ );
		expect( execSshMock ).not.toHaveBeenCalled();
	} );

	it( 'throws with output and guidance on failure', async () => {
		mockResult( { stderr: 'Error: Plugin not found.', exitCode: 1 } );
		await expect(
			getTool( 'wp_cli' ).rawHandler( { command: 'plugin activate nope' } as never )
		).rejects.toThrow( /Plugin not found/ );
	} );
} );
