import EventEmitter from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { killChild } from '@studio/common/lib/cli-process';
import type { ChildProcess } from 'node:child_process';

// `killChild` branches on the platform: signals on POSIX, `taskkill /F /T` on
// Windows. Pin it to POSIX so these run the same everywhere — on a Windows host
// they would otherwise fire a real `taskkill` at whatever holds this pid.
const originalPlatform = process.platform;
function setPlatform( platform: NodeJS.Platform ) {
	Object.defineProperty( process, 'platform', { value: platform, configurable: true } );
}

// A child that is still running: `kill()` records the signal but, like the real
// CLI (which registers a SIGTERM handler that never exits), it does not die.
function createStubbornChild() {
	const child = new EventEmitter() as unknown as ChildProcess & { signals: string[] };
	const signals: string[] = [];
	Object.assign( child, {
		pid: 1234,
		exitCode: null,
		signalCode: null,
		signals,
		kill: ( signal?: string ) => {
			signals.push( signal ?? 'SIGTERM' );
			return true;
		},
	} );
	return child as ChildProcess & { signals: string[] };
}

describe( 'killChild', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		setPlatform( 'darwin' );
	} );

	afterEach( () => {
		vi.useRealTimers();
		setPlatform( originalPlatform );
	} );

	it( 'escalates to SIGKILL when the child ignores SIGTERM', () => {
		const child = createStubbornChild();

		killChild( child );
		expect( child.signals ).toEqual( [ 'SIGTERM' ] );

		vi.advanceTimersByTime( 5000 );

		// Without this a cancelled sync reports "stopped" while the CLI keeps
		// importing into the site.
		expect( child.signals ).toEqual( [ 'SIGTERM', 'SIGKILL' ] );
	} );

	it( 'leaves a child that exits on SIGTERM alone', () => {
		const child = createStubbornChild();

		killChild( child );
		Object.assign( child, { exitCode: 0 } );
		child.emit( 'exit', 0, null );
		vi.advanceTimersByTime( 5000 );

		expect( child.signals ).toEqual( [ 'SIGTERM' ] );
	} );
} );
