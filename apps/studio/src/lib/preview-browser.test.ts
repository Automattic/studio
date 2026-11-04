import { webContents, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearWebviewBrowsingData,
	getOwnedWebviewContents,
	openWebviewDevTools,
	setWebviewColorScheme,
} from './preview-browser';

vi.mock( 'electron', () => ( {
	webContents: { fromId: vi.fn(), getAllWebContents: vi.fn() },
} ) );

const event = { sender: { id: 1 } } as IpcMainInvokeEvent;
function createContents( session = { clearData: vi.fn().mockResolvedValue( undefined ) } ) {
	return {
		isDestroyed: vi.fn().mockReturnValue( false ),
		getType: vi.fn().mockReturnValue( 'webview' ),
		hostWebContents: { id: 1 },
		session,
		openDevTools: vi.fn(),
		debugger: {
			isAttached: vi.fn().mockReturnValue( false ),
			attach: vi.fn(),
			sendCommand: vi.fn().mockResolvedValue( {} ),
		},
		stop: vi.fn(),
		once: vi.fn(),
		reload: vi.fn(),
		navigationHistory: { clear: vi.fn() },
	};
}
let target: ReturnType< typeof createContents >;
beforeEach( () => {
	target = createContents();
	vi.mocked( webContents.fromId ).mockReturnValue( target as unknown as WebContents );
	vi.mocked( webContents.getAllWebContents ).mockReturnValue( [
		target as unknown as WebContents,
	] );
} );

describe( 'preview browser controls', () => {
	it( 'rejects invalid identifiers, unrelated contents, and another window’s preview', () => {
		for ( const id of [ 0, -1, NaN, 1.5 ] ) {
			expect( () => getOwnedWebviewContents( event, id ) ).toThrow( 'Invalid webview' );
		}
		target.getType.mockReturnValue( 'window' );
		expect( () => openWebviewDevTools( event, 42 ) ).toThrow( 'does not belong' );
		target.getType.mockReturnValue( 'webview' );
		target.hostWebContents.id = 2;
		expect( () => openWebviewDevTools( event, 42 ) ).toThrow( 'does not belong' );
		expect( target.openDevTools ).not.toHaveBeenCalled();
	} );

	it( 'opens the owned preview’s standard DevTools', () => {
		openWebviewDevTools( event, 42 );
		expect( target.openDevTools ).toHaveBeenCalledWith( { mode: 'detach' } );
	} );

	it( 'emulates the preview color scheme and restores Chromium’s default for System', async () => {
		await setWebviewColorScheme( event, 42, 'dark' );
		expect( target.debugger.sendCommand ).toHaveBeenLastCalledWith( 'Emulation.setEmulatedMedia', {
			features: [ { name: 'prefers-color-scheme', value: 'dark' } ],
		} );
		target.debugger.isAttached.mockReturnValue( true );
		await setWebviewColorScheme( event, 42, 'light' );
		expect( target.debugger.sendCommand ).toHaveBeenLastCalledWith( 'Emulation.setEmulatedMedia', {
			features: [ { name: 'prefers-color-scheme', value: 'light' } ],
		} );
		await setWebviewColorScheme( event, 42, 'system' );
		expect( target.debugger.sendCommand ).toHaveBeenLastCalledWith( 'Emulation.setEmulatedMedia', {
			features: [],
		} );
		expect( target.debugger.attach ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'clears the shared preview session and history without touching the app session', async () => {
		const otherPreview = createContents( target.session );
		otherPreview.hostWebContents.id = 2;
		const appContents = createContents();
		appContents.getType.mockReturnValue( 'window' );
		vi.mocked( webContents.getAllWebContents ).mockReturnValue( [
			target,
			otherPreview,
			appContents,
		] as unknown as WebContents[] );
		await clearWebviewBrowsingData( event, 42 );
		expect( target.session.clearData ).toHaveBeenCalledOnce();
		for ( const preview of [ target, otherPreview ] ) {
			expect( preview.stop ).toHaveBeenCalledOnce();
			expect( preview.reload ).toHaveBeenCalledOnce();
			const clearHistory = preview.once.mock.calls.find(
				( [ name ] ) => name === 'did-stop-loading'
			)![ 1 ];
			clearHistory();
			expect( preview.navigationHistory.clear ).toHaveBeenCalledOnce();
		}
		expect( appContents.session.clearData ).not.toHaveBeenCalled();
		expect( appContents.reload ).not.toHaveBeenCalled();
	} );
} );
