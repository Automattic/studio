import { execFileSync } from 'child_process';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { removeMacQuarantine } from '@studio/common/lib/macos-quarantine';

const execFileSyncMock = vi.hoisted( () => vi.fn() );

vi.mock( 'child_process', () => ( {
	default: {
		execFileSync: execFileSyncMock,
	},
	execFileSync: execFileSyncMock,
} ) );

const mockedExecFileSync = vi.mocked( execFileSync );

describe( 'removeMacQuarantine', () => {
	beforeEach( () => {
		mockedExecFileSync.mockReset();
	} );

	it( 'removes quarantine on macOS', () => {
		removeMacQuarantine( '/tmp/php', 'darwin' );

		expect( mockedExecFileSync ).toHaveBeenCalledWith(
			'xattr',
			[ '-d', 'com.apple.quarantine', '/tmp/php' ],
			{ stdio: 'ignore' }
		);
	} );

	it( 'skips other platforms', () => {
		removeMacQuarantine( '/tmp/php', 'linux' );

		expect( mockedExecFileSync ).not.toHaveBeenCalled();
	} );

	it( 'ignores missing quarantine attributes', () => {
		mockedExecFileSync.mockImplementation( () => {
			throw new Error( 'No such xattr' );
		} );

		expect( () => removeMacQuarantine( '/tmp/php', 'darwin' ) ).not.toThrow();
	} );
} );
