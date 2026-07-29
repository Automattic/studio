/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import {
	buildPreviewContextMenuTemplate,
	type PreviewContextMenuActions,
	type PreviewContextMenuEnvironment,
	type PreviewContextMenuState,
} from 'src/preview-context-menu';
import type { ContextMenuParams } from 'electron';

vi.mock( 'electron', () => ( {
	Menu: { buildFromTemplate: vi.fn() },
	clipboard: { writeText: vi.fn() },
} ) );

type Params = Parameters< typeof buildPreviewContextMenuTemplate >[ 0 ];

function makeParams( overrides: Partial< Params > = {} ): Params {
	return {
		selectionText: '',
		isEditable: false,
		editFlags: {
			canCut: false,
			canCopy: false,
			canPaste: false,
			canSelectAll: true,
		} as ContextMenuParams[ 'editFlags' ],
		linkURL: '',
		srcURL: '',
		mediaType: 'none',
		hasImageContents: false,
		...overrides,
	};
}

function makeState( overrides: Partial< PreviewContextMenuState > = {} ): PreviewContextMenuState {
	return { canGoBack: true, canGoForward: false, ...overrides };
}

function makeEnvironment(
	overrides: Partial< PreviewContextMenuEnvironment > = {}
): PreviewContextMenuEnvironment {
	return { platform: 'darwin', isDevelopment: false, ...overrides };
}

function makeActions(): PreviewContextMenuActions {
	return {
		goBack: vi.fn(),
		goForward: vi.fn(),
		reload: vi.fn(),
		openLinkExternally: vi.fn(),
		copyToClipboard: vi.fn(),
		copyImage: vi.fn(),
		lookUpSelection: vi.fn(),
		inspectElement: vi.fn(),
	};
}

function labelsOf( template: ReturnType< typeof buildPreviewContextMenuTemplate > ) {
	return template.map( ( item ) => item.role ?? item.label ?? item.type );
}

describe( 'buildPreviewContextMenuTemplate', () => {
	it( 'offers page navigation when the click lands on nothing in particular', () => {
		const template = buildPreviewContextMenuTemplate(
			makeParams(),
			makeState(),
			makeActions(),
			makeEnvironment()
		);

		expect( labelsOf( template ) ).toEqual( [
			'selectAll',
			'separator',
			'Back',
			'Forward',
			'Reload',
		] );
	} );

	it( 'disables Back and Forward at the ends of history', () => {
		const template = buildPreviewContextMenuTemplate(
			makeParams(),
			makeState( { canGoBack: false, canGoForward: true } ),
			makeActions(),
			makeEnvironment()
		);

		expect( template.find( ( item ) => item.label === 'Back' )?.enabled ).toBe( false );
		expect( template.find( ( item ) => item.label === 'Forward' )?.enabled ).toBe( true );
	} );

	it( 'drops navigation when the pointer is on something specific, as Chrome does', () => {
		const template = buildPreviewContextMenuTemplate(
			makeParams( { linkURL: 'https://example.com/about' } ),
			makeState(),
			makeActions(),
			makeEnvironment()
		);

		expect( labelsOf( template ) ).toEqual( [
			'Open Link in Browser',
			'Copy Link Address',
			'separator',
			'selectAll',
		] );
	} );

	it( 'opens a link in the real browser rather than inside the preview', () => {
		const actions = makeActions();
		const template = buildPreviewContextMenuTemplate(
			makeParams( { linkURL: 'https://example.com/about' } ),
			makeState(),
			actions,
			makeEnvironment()
		);

		( template[ 0 ].click as () => void )();
		( template[ 1 ].click as () => void )();

		expect( actions.openLinkExternally ).toHaveBeenCalledWith( 'https://example.com/about' );
		expect( actions.copyToClipboard ).toHaveBeenCalledWith( 'https://example.com/about' );
	} );

	it( 'offers image actions only for an image with real contents', () => {
		const withImage = buildPreviewContextMenuTemplate(
			makeParams( {
				mediaType: 'image',
				hasImageContents: true,
				srcURL: 'https://example.com/logo.png',
			} ),
			makeState(),
			makeActions(),
			makeEnvironment()
		);
		expect( labelsOf( withImage ) ).toEqual( [
			'Copy Image',
			'Copy Image Address',
			'separator',
			'selectAll',
		] );

		// A broken image reports the type but has nothing to copy.
		const brokenImage = buildPreviewContextMenuTemplate(
			makeParams( { mediaType: 'image', hasImageContents: false } ),
			makeState(),
			makeActions(),
			makeEnvironment()
		);
		expect( labelsOf( brokenImage ) ).not.toContain( 'Copy Image' );
	} );

	it( 'offers Look Up for a selection on macOS only', () => {
		const params = makeParams( {
			selectionText: 'permalink',
			editFlags: { canCopy: true, canSelectAll: true } as ContextMenuParams[ 'editFlags' ],
		} );

		expect(
			labelsOf(
				buildPreviewContextMenuTemplate( params, makeState(), makeActions(), makeEnvironment() )
			)
		).toEqual( [ 'Look Up “permalink”', 'separator', 'copy', 'selectAll' ] );

		expect(
			labelsOf(
				buildPreviewContextMenuTemplate(
					params,
					makeState(),
					makeActions(),
					makeEnvironment( { platform: 'win32' } )
				)
			)
		).toEqual( [ 'copy', 'selectAll' ] );
	} );

	it( 'offers Cut and Paste only inside an editable field', () => {
		// A selection is what makes canCopy/canCut true in the first place, so
		// the params have to carry one for this to be a real-world state.
		const params = makeParams( {
			selectionText: 'permalink',
			editFlags: {
				canCut: true,
				canCopy: true,
				canPaste: true,
				canSelectAll: true,
			} as ContextMenuParams[ 'editFlags' ],
		} );
		const onWindows = makeEnvironment( { platform: 'win32' } );

		expect(
			labelsOf(
				buildPreviewContextMenuTemplate(
					{ ...params, isEditable: true },
					makeState(),
					makeActions(),
					onWindows
				)
			)
		).toEqual( [ 'cut', 'copy', 'paste', 'selectAll' ] );

		expect(
			labelsOf(
				buildPreviewContextMenuTemplate(
					{ ...params, isEditable: false },
					makeState(),
					makeActions(),
					onWindows
				)
			)
		).toEqual( [ 'copy', 'selectAll' ] );
	} );

	it( 'keeps Inspect Element out of production builds', () => {
		expect(
			labelsOf(
				buildPreviewContextMenuTemplate(
					makeParams(),
					makeState(),
					makeActions(),
					makeEnvironment( { isDevelopment: true } )
				)
			)
		).toContain( 'Inspect Element' );

		expect(
			labelsOf(
				buildPreviewContextMenuTemplate(
					makeParams(),
					makeState(),
					makeActions(),
					makeEnvironment()
				)
			)
		).not.toContain( 'Inspect Element' );
	} );

	it( 'collapses and truncates a long selection in the Look Up label', () => {
		const template = buildPreviewContextMenuTemplate(
			makeParams( { selectionText: '  the quick\n brown fox jumps over the dog  ' } ),
			makeState(),
			makeActions(),
			makeEnvironment()
		);

		expect( template[ 0 ].label ).toBe( 'Look Up “the quick brown fox jum…”' );
	} );

	it( 'never leads or trails with a separator', () => {
		const template = buildPreviewContextMenuTemplate(
			makeParams( {
				linkURL: 'https://example.com',
				selectionText: 'about',
				editFlags: { canCopy: true, canSelectAll: true } as ContextMenuParams[ 'editFlags' ],
			} ),
			makeState(),
			makeActions(),
			makeEnvironment( { isDevelopment: true } )
		);

		expect( template[ 0 ].type ).not.toBe( 'separator' );
		expect( template.at( -1 )?.type ).not.toBe( 'separator' );
		expect( labelsOf( template ) ).toEqual( [
			'Open Link in Browser',
			'Copy Link Address',
			'separator',
			'Look Up “about”',
			'separator',
			'copy',
			'selectAll',
			'separator',
			'Inspect Element',
		] );
	} );
} );
