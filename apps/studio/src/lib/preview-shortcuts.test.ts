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

function createGuest() {
	const host = { isDestroyed: () => false, focus: vi.fn(), sendInputEvent: vi.fn() };
	return { guest: { hostWebContents: host } as unknown as WebContents, host };
}

describe( 'forwardPreviewShortcut', () => {
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
