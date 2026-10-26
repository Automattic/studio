/**
 * @vitest-environment node
 */
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import { openLinuxTerminal } from '../user-settings/open-linux-terminal';

const { spawnMock, findOnPathMock } = vi.hoisted( () => ( {
	spawnMock: vi.fn(),
	findOnPathMock: vi.fn(),
} ) );

vi.mock( 'node:child_process', () => ( { spawn: spawnMock } ) );
vi.mock( '@studio/common/lib/user-settings/installed-apps', () => ( {
	findOnPath: findOnPathMock,
} ) );

const SITE = '/home/user/Studio/my site';

function fakeChild() {
	return Object.assign( new EventEmitter(), { unref: vi.fn() } );
}

describe( 'openLinuxTerminal', () => {
	beforeEach( () => {
		spawnMock.mockReset();
		findOnPathMock.mockImplementation( ( command: string ) =>
			command === 'konsole' ? '/usr/bin/konsole' : null
		);
	} );

	it( 'starts the terminal detached and settles once it has started', async () => {
		const child = fakeChild();
		spawnMock.mockReturnValue( child );

		const opening = openLinuxTerminal( 'terminal', SITE );
		child.emit( 'spawn' );
		await opening;

		expect( spawnMock ).toHaveBeenCalledWith( '/usr/bin/konsole', [ '--workdir', SITE ], {
			cwd: SITE,
			detached: true,
			stdio: 'ignore',
		} );
		expect( child.unref ).toHaveBeenCalled();
	} );

	it( 'rejects when the terminal fails to start', async () => {
		const child = fakeChild();
		spawnMock.mockReturnValue( child );

		const opening = openLinuxTerminal( 'terminal', SITE );
		child.emit( 'error', new Error( 'spawn EACCES' ) );

		await expect( opening ).rejects.toThrow( 'spawn EACCES' );
		expect( child.unref ).not.toHaveBeenCalled();
	} );

	it( 'rejects without spawning when no terminal is installed', async () => {
		findOnPathMock.mockReturnValue( null );

		await expect( openLinuxTerminal( 'terminal', SITE ) ).rejects.toThrow(
			'No supported terminal emulator found'
		);
		expect( spawnMock ).not.toHaveBeenCalled();
	} );
} );
