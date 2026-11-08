import { webContents, type IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAnnotationRegion } from '../capture-annotation-region';
import type { InspectorSelection } from '@studio/agent/protocol/inspector/selection';

vi.mock( 'electron', () => ( { webContents: { fromId: vi.fn() } } ) );

const selection: InspectorSelection = {
	id: 'capture-1',
	target: {
		kind: 'drawing',
		url: 'http://localhost:8881/',
		viewport: { width: 800, height: 600 },
		documentRect: { left: 20, top: 30, width: 200, height: 100 },
	},
	rect: { left: 20, top: 30, width: 200, height: 100 },
	scroll: { left: 0, top: 0 },
	drawing: { width: 3, color: '#3858e9', strokes: [ [ { x: 30, y: 40 } ] ] },
};
const sender = {};
const event = { sender } as IpcMainInvokeEvent;
const image = {
	isEmpty: () => false,
	getSize: () => ( { width: 400, height: 200 } ),
	toPNG: () => Buffer.from( 'png' ),
};
const guest = {
	id: 7,
	hostWebContents: sender,
	isDestroyed: () => false,
	getURL: vi.fn(),
	executeJavaScript: vi.fn(),
	capturePage: vi.fn(),
};

beforeEach( () => {
	vi.mocked( webContents.fromId ).mockReturnValue( guest as unknown as Electron.WebContents );
	guest.hostWebContents = sender;
	guest.getURL.mockReturnValue( selection.target.url );
	guest.executeJavaScript.mockReset().mockResolvedValue( undefined );
	guest.capturePage.mockReset().mockResolvedValue( image );
} );
afterEach( () => vi.useRealTimers() );

describe( 'annotation region capture', () => {
	it.each( [ 'region', 'drawing' ] as const )(
		'captures %s pixels as an image attachment',
		async ( kind ) => {
			const result = await captureAnnotationRegion( event, {
				guestId: 7,
				selection: {
					...selection,
					target: { ...selection.target, kind },
					drawing: kind === 'drawing' ? selection.drawing : undefined,
				},
			} );
			expect( guest.capturePage ).toHaveBeenCalledWith( { x: 20, y: 30, width: 200, height: 100 } );
			expect( guest.executeJavaScript.mock.calls[ 0 ][ 0 ] ).toContain(
				"host.setAttribute('data-capturing',"
			);
			expect( guest.executeJavaScript.mock.calls.at( -1 )?.[ 0 ] ).toContain(
				"removeAttribute('data-capturing')"
			);
			expect( result ).toMatchObject( {
				name: kind === 'drawing' ? 'Drawing.png' : 'Selected area.png',
				mimeType: 'image/png',
				width: 400,
				height: 200,
				size: 3,
				dataBase64: Buffer.from( 'png' ).toString( 'base64' ),
			} );
		}
	);
	it( 'rejects a guest owned by another window', async () => {
		guest.hostWebContents = {};
		await expect( captureAnnotationRegion( event, { guestId: 7, selection } ) ).rejects.toThrow(
			'no longer available'
		);
		expect( guest.capturePage ).not.toHaveBeenCalled();
	} );
	it( 'rejects a navigated page and invalid crops', async () => {
		guest.getURL.mockReturnValue( 'http://localhost:8881/other' );
		await expect( captureAnnotationRegion( event, { guestId: 7, selection } ) ).rejects.toThrow();
		guest.getURL.mockReturnValue( selection.target.url );
		await expect(
			captureAnnotationRegion( event, {
				guestId: 7,
				selection: { ...selection, rect: { ...selection.rect, width: -20 } },
			} )
		).rejects.toThrow();
		expect( guest.capturePage ).not.toHaveBeenCalled();
	} );
	it( 'restores annotation UI after a failed screenshot', async () => {
		guest.capturePage.mockRejectedValue( new Error( 'Capture failed' ) );
		await expect( captureAnnotationRegion( event, { guestId: 7, selection } ) ).rejects.toThrow(
			'Capture failed'
		);
		expect( guest.executeJavaScript.mock.calls.at( -1 )?.[ 0 ] ).toContain(
			"removeAttribute('data-capturing')"
		);
	} );
	it( 'times out without leaving the annotation UI hidden and permits retry', async () => {
		vi.useFakeTimers();
		guest.capturePage.mockImplementationOnce( () => new Promise( () => {} ) );
		const result = captureAnnotationRegion( event, { guestId: 7, selection } );
		const rejected = expect( result ).rejects.toThrow( 'timed out' );
		await vi.advanceTimersByTimeAsync( 10_000 );
		await rejected;
		expect( guest.executeJavaScript.mock.calls.at( -1 )?.[ 0 ] ).toContain(
			"removeAttribute('data-capturing')"
		);
		await expect(
			captureAnnotationRegion( event, { guestId: 7, selection } )
		).resolves.toMatchObject( { mimeType: 'image/png' } );
	} );
} );
