/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { forwardPreviewShortcut } from 'src/lib/preview-shortcuts';
import type { WebContents } from 'electron';

const input = {
	type: 'keyDown',
	key: 'k',
	code: 'KeyK',
	isAutoRepeat: false,
	isComposing: false,
	shift: false,
	control: false,
	alt: false,
	meta: true,
	location: 0,
	modifiers: [],
} as Electron.Input;

function createGuest( url = 'http://localhost:8881/' ) {
	const host = { isDestroyed: () => false, focus: vi.fn(), sendInputEvent: vi.fn() };
	return { guest: { hostWebContents: host, getURL: () => url } as unknown as WebContents, host };
}

describe( 'forwardPreviewShortcut', () => {
	it.each( [
		'/wp-admin',
		'/wp-admin/',
		'/wp-admin/index.php',
		'/wp-admin/site-editor.php?postId=home',
		'/wp-admin/post.php?post=1&action=edit',
		'/wp-admin/post-new.php',
		'/wordpress/wp-admin/edit.php',
		'/wp-admin/network/',
	] )( 'leaves the shortcut and focus in WordPress at %s', ( path ) => {
		for ( const platform of [ 'darwin', 'win32', 'linux' ] as const ) {
			const { guest, host } = createGuest( `http://localhost:8881${ path }` );
			const shortcut = { ...input, meta: platform === 'darwin', control: platform !== 'darwin' };
			expect( forwardPreviewShortcut( guest, shortcut, platform ) ).toBe( false );
			expect( host.focus ).not.toHaveBeenCalled();
			expect( host.sendInputEvent ).not.toHaveBeenCalled();
		}
	} );

	it.each( [
		'/',
		'/sample-page/',
		'/wp-login.php?redirect_to=%2Fwp-admin%2F',
		'/wordpress/wp-login.php',
		'/?next=/wp-admin/',
		'/#/wp-admin/',
		'/wp-admin-example/',
	] )( 'opens Studio’s palette at %s', ( path ) => {
		const { guest, host } = createGuest( `http://localhost:8881${ path }` );
		expect( forwardPreviewShortcut( guest, input, 'darwin' ) ).toBe( true );
		expect( host.focus ).toHaveBeenCalled();
		expect( host.sendInputEvent ).toHaveBeenCalled();
	} );

	it.each( [ 'darwin', 'win32', 'linux' ] as const )(
		'forwards the annotation shortcut from a %s preview',
		( platform ) => {
			const { guest, host } = createGuest();
			expect(
				forwardPreviewShortcut(
					guest,
					{
						...input,
						code: 'Period',
						key: '>',
						shift: true,
						meta: platform === 'darwin',
						control: platform !== 'darwin',
					},
					platform
				)
			).toBe( true );
			expect( host.sendInputEvent ).toHaveBeenCalledWith( {
				type: 'keyDown',
				keyCode: '.',
				modifiers: [ platform === 'darwin' ? 'meta' : 'control', 'shift' ],
			} );
		}
	);

	it( 'keeps other Studio shortcuts available in WordPress admin', () => {
		for ( const shortcut of [
			{ code: 'KeyT', key: 't' },
			{ code: 'Period', key: '>', shift: true },
		] ) {
			const { guest, host } = createGuest( 'http://localhost:8881/wp-admin/' );
			expect( forwardPreviewShortcut( guest, { ...input, ...shortcut }, 'darwin' ) ).toBe( true );
			expect( host.focus ).toHaveBeenCalled();
		}
	} );

	it.each( [ 'K', 'T' ] )( 'hands ⌘%s pressed in the preview to the window', ( key ) => {
		const { guest, host } = createGuest();
		expect(
			forwardPreviewShortcut(
				guest,
				{ ...input, code: `Key${ key }`, key: key.toLowerCase() },
				'darwin'
			)
		).toBe( true );
		expect( host.focus ).toHaveBeenCalled();
		expect( host.sendInputEvent ).toHaveBeenCalledWith( {
			type: 'keyDown',
			keyCode: key,
			modifiers: [ 'meta' ],
		} );
	} );

	it.each( [ 'darwin', 'win32', 'linux' ] as const )(
		'forwards the annotation shortcut on %s',
		( platform ) => {
			const { guest, host } = createGuest();
			expect(
				forwardPreviewShortcut(
					guest,
					{
						...input,
						code: 'Period',
						key: '>',
						shift: true,
						meta: platform === 'darwin',
						control: platform !== 'darwin',
					},
					platform
				)
			).toBe( true );
			expect( host.sendInputEvent ).toHaveBeenCalledWith( {
				type: 'keyDown',
				keyCode: '.',
				modifiers: [ platform === 'darwin' ? 'meta' : 'control', 'shift' ],
			} );
		}
	);

	it( 'leaves other keys, and ⌘K elsewhere than macOS, to the page', () => {
		const { guest, host } = createGuest();
		expect( forwardPreviewShortcut( guest, { ...input, shift: true }, 'darwin' ) ).toBe( false );
		expect( forwardPreviewShortcut( guest, input, 'win32' ) ).toBe( false );
		expect(
			forwardPreviewShortcut( guest, { ...input, meta: false, control: true }, 'win32' )
		).toBe( true );
		expect( host.sendInputEvent ).toHaveBeenLastCalledWith(
			expect.objectContaining( { modifiers: [ 'control' ] } )
		);
	} );
} );
