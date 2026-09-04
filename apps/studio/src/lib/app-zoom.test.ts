/**
 * @vitest-environment node
 */
import { webContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAppZoomCommand, getAppZoomCommand, resetPreviewZoom } from 'src/lib/app-zoom';

vi.mock( 'electron', () => ( {
	webContents: { getAllWebContents: vi.fn().mockReturnValue( [] ) },
} ) );

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

function createContents( {
	id = 1,
	type = 'window',
	zoomLevel = 0,
	hostId,
}: { id?: number; type?: string; zoomLevel?: number; hostId?: number } = {} ) {
	return {
		id,
		getType: vi.fn().mockReturnValue( type ),
		hostWebContents: hostId === undefined ? undefined : { id: hostId },
		isDestroyed: vi.fn().mockReturnValue( false ),
		getZoomLevel: vi.fn().mockReturnValue( zoomLevel ),
		setZoomLevel: vi.fn(),
	};
}

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
	beforeEach( () => {
		vi.mocked( webContents.getAllWebContents ).mockReturnValue( [] );
	} );

	it.each( [
		[ 'reset', 0 ],
		[ 'in', 1.5 ],
		[ 'out', 0.5 ],
	] as const )( 'applies %s to the app web contents', ( command, expectedLevel ) => {
		const contents = createContents( { zoomLevel: 1 } );

		applyAppZoomCommand( contents as never, command );

		expect( contents.setZoomLevel ).toHaveBeenCalledWith( expectedLevel );
	} );

	it( 'pins the site previews hosted by that window back to 1:1', () => {
		const app = createContents( { id: 1, zoomLevel: 1 } );
		// By the time `setZoomLevel` returns, Electron has already copied the
		// app's new level onto its guests.
		const preview = createContents( { id: 2, type: 'webview', hostId: 1, zoomLevel: 1.5 } );
		const otherWindowPreview = createContents( {
			id: 3,
			type: 'webview',
			hostId: 9,
			zoomLevel: 1.5,
		} );
		const otherWindow = createContents( { id: 4, zoomLevel: 1.5 } );
		vi.mocked( webContents.getAllWebContents ).mockReturnValue( [
			app,
			preview,
			otherWindowPreview,
			otherWindow,
		] as never );

		applyAppZoomCommand( app as never, 'in' );

		expect( preview.setZoomLevel ).toHaveBeenCalledWith( 0 );
		expect( otherWindowPreview.setZoomLevel ).not.toHaveBeenCalled();
		expect( otherWindow.setZoomLevel ).not.toHaveBeenCalled();
	} );
} );

describe( 'resetPreviewZoom', () => {
	it( 'resets a zoomed guest', () => {
		const guest = createContents( { type: 'webview', zoomLevel: 0.5 } );

		resetPreviewZoom( guest as never );

		expect( guest.setZoomLevel ).toHaveBeenCalledWith( 0 );
	} );

	it( 'leaves an unzoomed or destroyed guest alone', () => {
		const unzoomed = createContents( { type: 'webview', zoomLevel: 0 } );
		const destroyed = createContents( { type: 'webview', zoomLevel: 0.5 } );
		destroyed.isDestroyed.mockReturnValue( true );

		resetPreviewZoom( unzoomed as never );
		resetPreviewZoom( destroyed as never );

		expect( unzoomed.setZoomLevel ).not.toHaveBeenCalled();
		expect( destroyed.setZoomLevel ).not.toHaveBeenCalled();
	} );
} );
