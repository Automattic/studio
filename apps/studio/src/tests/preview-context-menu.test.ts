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
	return { inspectorReady: true, ...overrides };
}

function makeEnvironment(
	overrides: Partial< PreviewContextMenuEnvironment > = {}
): PreviewContextMenuEnvironment {
	return { platform: 'darwin', ...overrides };
}

function makeActions(): PreviewContextMenuActions {
	return {
		annotateElement: vi.fn(),
		addElementToChat: vi.fn(),
		openExternally: vi.fn(),
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
	it( 'offers only the element actions and Inspect on plain page text', () => {
		const template = buildPreviewContextMenuTemplate(
			makeParams(),
			makeState(),
			makeActions(),
			makeEnvironment()
		);

		expect( labelsOf( template ) ).toEqual( [
			'Annotate Element',
			'Add to Chat',
			'separator',
			'Inspect Element',
		] );
	} );

	it( 'leaves the element actions out while the inspector is not attached', () => {
		const template = buildPreviewContextMenuTemplate(
			makeParams(),
			makeState( { inspectorReady: false } ),
			makeActions(),
			makeEnvironment()
		);

		expect( labelsOf( template ) ).toEqual( [ 'Inspect Element' ] );
	} );

	it( 'hands the element actions straight to the guest page', () => {
		const actions = makeActions();
		const template = buildPreviewContextMenuTemplate(
			makeParams(),
			makeState(),
			actions,
			makeEnvironment()
		);

		( template[ 0 ].click as () => void )();
		( template[ 1 ].click as () => void )();

		expect( actions.annotateElement ).toHaveBeenCalledOnce();
		expect( actions.addElementToChat ).toHaveBeenCalledOnce();
	} );

	it( 'offers link actions that leave the preview', () => {
		const actions = makeActions();
		const template = buildPreviewContextMenuTemplate(
			makeParams( { linkURL: 'https://example.com/about' } ),
			makeState( { inspectorReady: false } ),
			actions,
			makeEnvironment()
		);

		expect( labelsOf( template ) ).toEqual( [
			'Open Link in Browser',
			'Copy Link Address',
			'separator',
			'Inspect Element',
		] );

		( template[ 0 ].click as () => void )();
		( template[ 1 ].click as () => void )();
		expect( actions.openExternally ).toHaveBeenCalledWith( 'https://example.com/about' );
		expect( actions.copyToClipboard ).toHaveBeenCalledWith( 'https://example.com/about' );
	} );

	it( 'offers image actions only for an image with real contents', () => {
		const actions = makeActions();
		const withImage = buildPreviewContextMenuTemplate(
			makeParams( {
				mediaType: 'image',
				hasImageContents: true,
				srcURL: 'https://example.com/logo.png',
			} ),
			makeState( { inspectorReady: false } ),
			actions,
			makeEnvironment()
		);
		expect( labelsOf( withImage ) ).toEqual( [
			'Copy Image',
			'Copy Image Address',
			'Open Image in Browser',
			'separator',
			'Inspect Element',
		] );

		( withImage[ 2 ].click as () => void )();
		expect( actions.openExternally ).toHaveBeenCalledWith( 'https://example.com/logo.png' );

		// A broken image reports the type but has nothing to copy or open.
		const brokenImage = buildPreviewContextMenuTemplate(
			makeParams( { mediaType: 'image', hasImageContents: false } ),
			makeState( { inspectorReady: false } ),
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
		const state = makeState( { inspectorReady: false } );

		expect(
			labelsOf( buildPreviewContextMenuTemplate( params, state, makeActions(), makeEnvironment() ) )
		).toEqual( [ 'Look Up “permalink”', 'separator', 'copy', 'separator', 'Inspect Element' ] );

		expect(
			labelsOf(
				buildPreviewContextMenuTemplate(
					params,
					state,
					makeActions(),
					makeEnvironment( { platform: 'win32' } )
				)
			)
		).toEqual( [ 'copy', 'separator', 'Inspect Element' ] );
	} );

	it( 'keeps Cut, Paste and Select All to fields the user can type in', () => {
		const editFlags = {
			canCut: true,
			canCopy: true,
			canPaste: true,
			canSelectAll: true,
		} as ContextMenuParams[ 'editFlags' ];
		const state = makeState( { inspectorReady: false } );
		const onWindows = makeEnvironment( { platform: 'win32' } );

		expect(
			labelsOf(
				buildPreviewContextMenuTemplate(
					makeParams( { isEditable: true, selectionText: 'permalink', editFlags } ),
					state,
					makeActions(),
					onWindows
				)
			)
		).toEqual( [ 'cut', 'copy', 'paste', 'selectAll', 'separator', 'Inspect Element' ] );

		// Page text gets Copy and nothing else — Select All would highlight the
		// whole document, which is never what was wanted here.
		expect(
			labelsOf(
				buildPreviewContextMenuTemplate(
					makeParams( { isEditable: false, selectionText: 'permalink', editFlags } ),
					state,
					makeActions(),
					onWindows
				)
			)
		).toEqual( [ 'copy', 'separator', 'Inspect Element' ] );
	} );

	it( 'offers Inspect Element in production too', () => {
		const template = buildPreviewContextMenuTemplate(
			makeParams(),
			makeState( { inspectorReady: false } ),
			makeActions(),
			makeEnvironment()
		);

		expect( labelsOf( template ) ).toContain( 'Inspect Element' );
	} );

	it( 'collapses and truncates a long selection in the Look Up label', () => {
		const template = buildPreviewContextMenuTemplate(
			makeParams( { selectionText: '  the quick\n brown fox jumps over the dog  ' } ),
			makeState( { inspectorReady: false } ),
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
			makeEnvironment()
		);

		expect( template[ 0 ].type ).not.toBe( 'separator' );
		expect( template.at( -1 )?.type ).not.toBe( 'separator' );
		expect( labelsOf( template ) ).toEqual( [
			'Annotate Element',
			'Add to Chat',
			'separator',
			'Open Link in Browser',
			'Copy Link Address',
			'separator',
			'Look Up “about”',
			'separator',
			'copy',
			'separator',
			'Inspect Element',
		] );
	} );
} );
