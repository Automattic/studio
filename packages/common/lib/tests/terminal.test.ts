/**
 * @vitest-environment node
 */
import { resolveLinuxTerminalLaunch } from '../user-settings/terminal';

const SITE = '/home/user/Studio/my site';

function findIn( ...commands: string[] ) {
	return ( command: string ) => ( commands.includes( command ) ? `/usr/bin/${ command }` : null );
}

describe( 'resolveLinuxTerminalLaunch', () => {
	it( 'prefers the desktop default terminal launcher over specific terminals', () => {
		expect(
			resolveLinuxTerminalLaunch(
				'terminal',
				SITE,
				findIn( 'x-terminal-emulator', 'gnome-terminal' )
			)
		).toEqual( { file: '/usr/bin/x-terminal-emulator', args: [], cwd: SITE } );
	} );

	it( 'prefers xdg-terminal-exec over x-terminal-emulator', () => {
		expect(
			resolveLinuxTerminalLaunch(
				'terminal',
				SITE,
				findIn( 'x-terminal-emulator', 'xdg-terminal-exec' )
			)
		).toEqual( { file: '/usr/bin/xdg-terminal-exec', args: [], cwd: SITE } );
	} );

	it( 'opens Xfce Terminal when GNOME Terminal is not installed', () => {
		expect( resolveLinuxTerminalLaunch( 'terminal', SITE, findIn( 'xfce4-terminal' ) ) ).toEqual( {
			file: '/usr/bin/xfce4-terminal',
			args: [ `--working-directory=${ SITE }` ],
			cwd: SITE,
		} );
	} );

	it( 'passes the folder as its own argument to terminals that take it separately', () => {
		expect( resolveLinuxTerminalLaunch( 'terminal', SITE, findIn( 'konsole' ) ) ).toEqual( {
			file: '/usr/bin/konsole',
			args: [ '--workdir', SITE ],
			cwd: SITE,
		} );
	} );

	it( 'uses the preferred terminal when it is installed', () => {
		expect(
			resolveLinuxTerminalLaunch( 'ghostty', SITE, findIn( 'ghostty', 'x-terminal-emulator' ) )
		).toEqual( {
			file: '/usr/bin/ghostty',
			args: [ `--working-directory=${ SITE }` ],
			cwd: SITE,
		} );
		expect(
			resolveLinuxTerminalLaunch( 'warp', SITE, findIn( 'warp-terminal', 'x-terminal-emulator' ) )
		).toEqual( { file: '/usr/bin/warp-terminal', args: [], cwd: SITE } );
	} );

	it( 'falls back to a system terminal when the preferred one is missing', () => {
		expect( resolveLinuxTerminalLaunch( 'ghostty', SITE, findIn( 'kitty' ) ) ).toEqual( {
			file: '/usr/bin/kitty',
			args: [ '--directory', SITE ],
			cwd: SITE,
		} );
	} );

	it( 'falls back to a system terminal for a preference with no Linux build', () => {
		expect( resolveLinuxTerminalLaunch( 'iterm', SITE, findIn( 'x-terminal-emulator' ) ) ).toEqual(
			{ file: '/usr/bin/x-terminal-emulator', args: [], cwd: SITE }
		);
	} );

	it( 'returns null when no known terminal is installed', () => {
		expect( resolveLinuxTerminalLaunch( 'terminal', SITE, findIn() ) ).toBeNull();
	} );
} );
