/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { applyAppZoomCommand, getAppZoomCommand } from 'src/lib/app-zoom';

const input = {
	type: 'keyDown',
	key: '',
	code: '',
	isAutoRepeat: false,
	isComposing: false,
	shift: false,
	control: false,
	alt: false,
	meta: false,
	location: 0,
	modifiers: [],
} as Electron.Input;

describe( 'getAppZoomCommand', () => {
	it.each( [
		[ 'darwin', { key: '+', meta: true, shift: true }, 'in' ],
		[ 'darwin', { key: '=', meta: true }, 'in' ],
		[ 'darwin', { key: '-', meta: true }, 'out' ],
		[ 'darwin', { key: '0', meta: true }, 'reset' ],
		[ 'win32', { key: '+', control: true, shift: true }, 'in' ],
		[ 'win32', { key: '-', control: true }, 'out' ],
		[ 'win32', { key: '0', control: true }, 'reset' ],
		[ 'linux', { key: '=', control: true }, 'in' ],
		[ 'linux', { key: '_', control: true, shift: true }, 'out' ],
	] as const )( 'maps %s %j to %s', ( platform, overrides, command ) => {
		expect( getAppZoomCommand( { ...input, ...overrides }, platform ) ).toBe( command );
	} );

	it( 'ignores shortcuts with the wrong platform modifier', () => {
		expect( getAppZoomCommand( { ...input, key: '+', control: true }, 'darwin' ) ).toBeNull();
		expect( getAppZoomCommand( { ...input, key: '+', meta: true }, 'win32' ) ).toBeNull();
	} );
} );

describe( 'applyAppZoomCommand', () => {
	it.each( [
		[ 'reset', 0 ],
		[ 'in', 1.5 ],
		[ 'out', 0.5 ],
	] as const )( 'applies %s to the app web contents', ( command, expectedLevel ) => {
		const contents = {
			getZoomLevel: vi.fn().mockReturnValue( 1 ),
			setZoomLevel: vi.fn(),
		};

		applyAppZoomCommand( contents as never, command );

		expect( contents.setZoomLevel ).toHaveBeenCalledWith( expectedLevel );
	} );
} );
