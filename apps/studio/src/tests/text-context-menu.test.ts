/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import {
	buildTextContextMenuTemplate,
	type TextContextMenuContext,
	type TextContextMenuEnvironment,
} from 'src/text-context-menu';

vi.mock( 'electron', () => ( {
	BrowserWindow: { fromWebContents: vi.fn() },
	Menu: { buildFromTemplate: vi.fn() },
	clipboard: { readText: vi.fn(), writeText: vi.fn() },
} ) );

function makeContext( overrides: Partial< TextContextMenuContext > = {} ): TextContextMenuContext {
	return { selectionText: '', isEditable: false, ...overrides };
}

function makeEnvironment(
	overrides: Partial< TextContextMenuEnvironment > = {}
): TextContextMenuEnvironment {
	return { platform: 'darwin', canPaste: false, ...overrides };
}

const actions = { lookUpSelection: vi.fn(), copyMessage: vi.fn() };

function labelsOf( template: ReturnType< typeof buildTextContextMenuTemplate > ) {
	return template.map( ( item ) => item.role ?? item.label ?? item.type );
}

describe( 'buildTextContextMenuTemplate', () => {
	it( 'offers Look Up, Copy and Copy All for a selection on a message on macOS', () => {
		const template = buildTextContextMenuTemplate(
			makeContext( { selectionText: 'coexist', messageText: 'Dark mode and core coexist.' } ),
			actions,
			makeEnvironment()
		);

		expect( labelsOf( template ) ).toEqual( [
			'Look Up “coexist”',
			'separator',
			'copy',
			'Copy All',
		] );
	} );

	it( 'omits Look Up on Windows and Linux, which have no system dictionary', () => {
		for ( const platform of [ 'win32', 'linux' ] as const ) {
			const template = buildTextContextMenuTemplate(
				makeContext( { selectionText: 'coexist', messageText: 'Dark mode and core coexist.' } ),
				actions,
				makeEnvironment( { platform } )
			);

			expect( labelsOf( template ) ).toEqual( [ 'copy', 'Copy All' ] );
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
			makeContext( { selectionText: 'coexist' } ),
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
