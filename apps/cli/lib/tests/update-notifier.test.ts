/* eslint-disable no-control-regex */
import { type MockInstance, vi } from 'vitest';
import { formatUpdateBanner, setupUpdateNotifier } from 'cli/lib/update-notifier';

describe( 'formatUpdateBanner', () => {
	it( 'should include version numbers', () => {
		const banner = formatUpdateBanner( '1.7.8', '1.8.0' );
		const plain = banner.replace( /\u001B\[[0-9;]*m/g, '' );
		expect( plain ).toContain( '1.7.8' );
		expect( plain ).toContain( '1.8.0' );
	} );

	it( 'should include the changelog URL', () => {
		const banner = formatUpdateBanner( '1.7.8', '1.8.0' );
		const plain = banner.replace( /\u001B\[[0-9;]*m/g, '' );
		expect( plain ).toContain(
			'https://developer.wordpress.com/docs/developer-tools/studio/changelog/'
		);
	} );

	it( 'should include the npm update command', () => {
		const banner = formatUpdateBanner( '1.7.8', '1.8.0' );
		const plain = banner.replace( /\u001B\[[0-9;]*m/g, '' );
		expect( plain ).toContain( 'npm update -g wp-studio' );
	} );

	it( 'should be wrapped in a box', () => {
		const banner = formatUpdateBanner( '1.0.0', '2.0.0' );
		const plain = banner.replace( /\u001B\[[0-9;]*m/g, '' );
		expect( plain ).toContain( '╭' );
		expect( plain ).toContain( '╰' );
		expect( plain ).toContain( '│' );
	} );
} );

describe( 'setupUpdateNotifier', () => {
	const originalSend = process.send;
	let stderrWriteSpy: MockInstance;

	beforeEach( () => {
		stderrWriteSpy = vi.spyOn( process.stderr, 'write' ).mockImplementation( () => true );
	} );

	afterEach( () => {
		process.send = originalSend;
		stderrWriteSpy.mockRestore();
	} );

	it( 'should not show banner when in IPC mode', () => {
		process.send = vi.fn();
		setupUpdateNotifier( '1.0.0' );
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
	} );
} );
