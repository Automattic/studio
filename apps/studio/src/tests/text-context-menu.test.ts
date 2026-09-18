/**
 * @vitest-environment node
 */
import { BrowserWindow, clipboard, Menu, type IpcMainInvokeEvent } from 'electron';
import { vi } from 'vitest';
import {
	buildTextContextMenuTemplate,
	hasTextClipboardFormat,
	showTextContextMenu,
	type TextContextMenuContext,
	type TextContextMenuEnvironment,
} from 'src/text-context-menu';

vi.mock( 'electron', () => ( {
	BrowserWindow: { fromWebContents: vi.fn() },
	Menu: { buildFromTemplate: vi.fn() },
	clipboard: { has: vi.fn(), writeText: vi.fn() },
} ) );

function makeContext( overrides: Partial< TextContextMenuContext > = {} ): TextContextMenuContext {
	return { selectionText: '', isEditable: false, ...overrides };
}

function makeEnvironment(
	overrides: Partial< TextContextMenuEnvironment > = {}
): TextContextMenuEnvironment {
	return { platform: 'darwin', canPaste: false, ...overrides };
}

const actions = {
	lookUpSelection: vi.fn(),
	copyMessage: vi.fn(),
	copyCode: vi.fn(),
	quoteSelection: vi.fn(),
};

function labelsOf( template: ReturnType< typeof buildTextContextMenuTemplate > ) {
	return template.map( ( item ) => item.role ?? item.label ?? item.type );
}

describe( 'buildTextContextMenuTemplate', () => {
	it( 'offers Look Up, Copy and Copy All for a selection on a message on macOS', () => {
		const template = buildTextContextMenuTemplate(
			makeContext( {
				selectionText: 'coexist',
				messageText: 'Dark mode and core coexist.',
				canQuoteSelection: true,
			} ),
			actions,
			makeEnvironment()
		);

		expect( labelsOf( template ) ).toEqual( [
			'Look Up “coexist”',
			'separator',
			'copy',
			'Copy All',
			'separator',
			'Quote in composer',
		] );
	} );

	it( 'omits Look Up on Windows and Linux, which have no system dictionary', () => {
		for ( const platform of [ 'win32', 'linux' ] as const ) {
			const template = buildTextContextMenuTemplate(
				makeContext( {
					selectionText: 'coexist',
					messageText: 'Dark mode and core coexist.',
					canQuoteSelection: true,
				} ),
				actions,
				makeEnvironment( { platform } )
			);

			expect( labelsOf( template ) ).toEqual( [
				'copy',
				'Copy All',
				'separator',
				'Quote in composer',
			] );
		}
	} );

	it( 'runs showDefinitionForSelection when Look Up is chosen', () => {
		const lookUpSelection = vi.fn();
		const template = buildTextContextMenuTemplate(
			makeContext( { selectionText: 'coexist' } ),
			{ ...actions, lookUpSelection },
			makeEnvironment()
		);

		( template[ 0 ].click as () => void )();

		expect( lookUpSelection ).toHaveBeenCalledOnce();
	} );

	it( 'copies the whole message, not the selection, from Copy All', () => {
		const copyMessage = vi.fn();
		const template = buildTextContextMenuTemplate(
			makeContext( { selectionText: 'coexist', messageText: 'Dark mode and core coexist.' } ),
			{ ...actions, copyMessage },
			makeEnvironment( { platform: 'linux' } )
		);
		const copyAll = template.find( ( item ) => item.label === 'Copy All' );

		( copyAll?.click as () => void )();

		expect( copyMessage ).toHaveBeenCalledWith( 'Dark mode and core coexist.' );
	} );

	it( 'offers Copy code within a code block and copies only that code', () => {
		const copyCode = vi.fn();
		const template = buildTextContextMenuTemplate(
			makeContext( {
				messageText: 'Before.\n\nconst answer = 42;\n\nAfter.',
				codeText: 'const answer = 42;',
			} ),
			{ ...actions, copyCode },
			makeEnvironment( { platform: 'linux' } )
		);
		const copyCodeItem = template.find( ( item ) => item.label === 'Copy code' );

		( copyCodeItem?.click as () => void )();

		expect( labelsOf( template ) ).toEqual( [ 'Copy code', 'Copy All' ] );
		expect( copyCode ).toHaveBeenCalledWith( 'const answer = 42;' );
	} );

	it( 'offers a translated label for role-based clipboard actions', () => {
		const template = buildTextContextMenuTemplate(
			makeContext( { selectionText: 'coexist', isEditable: true } ),
			actions,
			makeEnvironment( { platform: 'linux', canPaste: true } )
		);

		expect( template.find( ( item ) => item.role === 'copy' )?.label ).toBe( 'Copy' );
		expect( template.find( ( item ) => item.role === 'paste' )?.label ).toBe( 'Paste' );
	} );

	it( 'offers quoting for a selection in an agent reply and runs its action', () => {
		const quoteSelection = vi.fn();
		const template = buildTextContextMenuTemplate(
			makeContext( { selectionText: 'coexist', canQuoteSelection: true } ),
			{ ...actions, quoteSelection },
			makeEnvironment( { platform: 'linux' } )
		);
		const quote = template.find( ( item ) => item.label === 'Quote in composer' );

		( quote?.click as () => void )();

		expect( quoteSelection ).toHaveBeenCalledOnce();
	} );

	it( 'does not offer quoting for selected text outside an agent reply', () => {
		const template = buildTextContextMenuTemplate(
			makeContext( { selectionText: 'wp plugin list' } ),
			actions,
			makeEnvironment( { platform: 'linux' } )
		);

		expect( labelsOf( template ) ).toEqual( [ 'copy' ] );
	} );

	it( 'collapses and truncates a long selection in the Look Up label', () => {
		const template = buildTextContextMenuTemplate(
			makeContext( { selectionText: '  core color\n schemes and dark mode now coexist  ' } ),
			actions,
			makeEnvironment()
		);

		expect( template[ 0 ].label ).toBe( 'Look Up “core color schemes and…”' );
	} );

	it( 'offers Paste only in an editable field with something on the clipboard', () => {
		expect(
			labelsOf(
				buildTextContextMenuTemplate(
					makeContext( { isEditable: true } ),
					actions,
					makeEnvironment( { canPaste: true } )
				)
			)
		).toEqual( [ 'paste' ] );

		expect(
			labelsOf(
				buildTextContextMenuTemplate(
					makeContext( { isEditable: false } ),
					actions,
					makeEnvironment( { canPaste: true } )
				)
			)
		).toEqual( [] );

		expect(
			labelsOf(
				buildTextContextMenuTemplate(
					makeContext( { isEditable: true } ),
					actions,
					makeEnvironment( { canPaste: false } )
				)
			)
		).toEqual( [] );
	} );

	it( 'leaves no stray separator when a section drops out', () => {
		// Look Up applies but there is no message to copy, so the divider must
		// still sit between two populated sections rather than trailing.
		const template = buildTextContextMenuTemplate(
			makeContext( { selectionText: 'coexist' } ),
			actions,
			makeEnvironment()
		);

		expect( labelsOf( template ) ).toEqual( [ 'Look Up “coexist”', 'separator', 'copy' ] );
		expect( template[ 0 ].type ).not.toBe( 'separator' );
		expect( template.at( -1 )?.type ).not.toBe( 'separator' );
	} );

	it( 'drops the divider when only the clipboard section applies', () => {
		const template = buildTextContextMenuTemplate(
			makeContext( { selectionText: 'coexist', isEditable: true } ),
			actions,
			makeEnvironment( { platform: 'win32' } )
		);

		expect( labelsOf( template ) ).toEqual( [ 'copy' ] );
	} );

	it( 'returns nothing to show when no text action applies', () => {
		const template = buildTextContextMenuTemplate(
			makeContext(),
			actions,
			makeEnvironment( { platform: 'win32' } )
		);

		expect( template ).toEqual( [] );
	} );
} );

describe( 'hasTextClipboardFormat', () => {
	it( 'detects plain text without reading clipboard contents', async () => {
		vi.mocked( clipboard.has ).mockResolvedValue( true );
		await expect( hasTextClipboardFormat() ).resolves.toBe( true );
		expect( clipboard.has ).toHaveBeenCalledWith( 'text/plain' );

		vi.mocked( clipboard.has ).mockResolvedValue( false );
		await expect( hasTextClipboardFormat() ).resolves.toBe( false );
	} );
} );

describe( 'showTextContextMenu', () => {
	it( 'returns the selected text when Quote in composer is chosen', async () => {
		const popup = vi.fn();
		vi.mocked( BrowserWindow.fromWebContents ).mockReturnValue( null );
		vi.mocked( clipboard.has ).mockResolvedValue( false );
		vi.mocked( Menu.buildFromTemplate ).mockReturnValue( { popup } as unknown as Menu );
		const event = {
			sender: { showDefinitionForSelection: vi.fn() },
		} as unknown as IpcMainInvokeEvent;

		const resultPromise = showTextContextMenu(
			event,
			makeContext( { selectionText: 'Selected reply', canQuoteSelection: true } )
		);
		// The clipboard check is awaited before the menu is built.
		await vi.waitFor( () => expect( Menu.buildFromTemplate ).toHaveBeenCalled() );
		const template = vi.mocked( Menu.buildFromTemplate ).mock.calls[ 0 ][ 0 ];
		const quote = template.find( ( item ) => item.label === 'Quote in composer' );
		( quote?.click as () => void )();
		const popupOptions = popup.mock.calls[ 0 ][ 0 ];
		popupOptions.callback();

		await expect( resultPromise ).resolves.toEqual( {
			action: 'quote-selection',
			selectionText: 'Selected reply',
		} );
	} );
} );
