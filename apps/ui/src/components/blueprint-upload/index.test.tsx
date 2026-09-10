import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { BlueprintUpload, type SelectedBlueprint } from './index';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return { ...actual, useConnector: vi.fn() };
} );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const cleanupBlueprintTempDir = vi.fn( async () => undefined );
const extractBlueprintBundle = vi.fn();

function createFile( name: string, contents: string, type: string ): File {
	const file = new File( [ contents ], name, { type } );
	Object.defineProperty( file, 'text', { value: vi.fn( async () => contents ) } );
	return file;
}

function deferred< T >() {
	let resolve!: ( value: T ) => void;
	const promise = new Promise< T >( ( promiseResolve ) => {
		resolve = promiseResolve;
	} );
	return { promise, resolve };
}

function TestUpload( {
	onSelect = vi.fn(),
	onValidityChange = vi.fn(),
}: {
	onSelect?: ( value: SelectedBlueprint ) => void;
	onValidityChange?: ( isValid: boolean ) => void;
} ) {
	const [ selected, setSelected ] = useState< SelectedBlueprint | null >( null );
	return (
		<BlueprintUpload
			selected={ selected }
			onSelect={ ( value ) => {
				setSelected( value );
				onSelect( value );
			} }
			onRemove={ () => setSelected( null ) }
			onValidityChange={ onValidityChange }
		/>
	);
}

function chooseFile( file: File ) {
	const input = document.querySelector< HTMLInputElement >( 'input[type="file"]' );
	if ( ! input ) throw new Error( 'File input not found' );
	fireEvent.change( input, { target: { files: [ file ] } } );
}

describe( 'BlueprintUpload', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( {
			extractBlueprintBundle,
			cleanupBlueprintTempDir,
		} );
	} );

	it( 'selects and removes a JSON Blueprint', async () => {
		const onSelect = vi.fn();
		render( <TestUpload onSelect={ onSelect } /> );
		chooseFile(
			createFile(
				'portfolio.json',
				JSON.stringify( { meta: { title: 'Portfolio Blueprint', author: 'Studio' } } ),
				'application/json'
			)
		);

		await waitFor( () => expect( onSelect ).toHaveBeenCalledOnce() );
		expect( onSelect.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			title: 'Portfolio Blueprint',
			file: { name: 'portfolio.json' },
		} );
		expect( screen.getByRole( 'button', { name: 'Replace' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Replace' } ).closest( 'p' ) ).toHaveTextContent(
			'Using portfolio.json. Replace or remove.'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'remove' } ) );
		expect(
			screen.getByRole( 'button', { name: 'upload a file' } ).closest( 'p' )
		).toHaveTextContent( 'Have a blueprint? Drop it anywhere, or upload a file.' );
	} );

	it( 'extracts a ZIP Blueprint and keeps its temporary-file metadata', async () => {
		const onSelect = vi.fn();
		extractBlueprintBundle.mockResolvedValue( {
			blueprintJson: { meta: { title: 'Bundled Blueprint', author: 'Studio' } },
			blueprintJsonPath: '/tmp/extracted/blueprint.json',
			tempDir: '/tmp/extracted',
		} );
		render( <TestUpload onSelect={ onSelect } /> );
		chooseFile( createFile( 'bundle.zip', 'zip', 'application/zip' ) );

		await waitFor( () => expect( onSelect ).toHaveBeenCalledOnce() );
		expect( extractBlueprintBundle ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'bundle.zip' } )
		);
		expect( onSelect.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			filePath: '/tmp/extracted/blueprint.json',
			tempDir: '/tmp/extracted',
		} );
		expect( cleanupBlueprintTempDir ).not.toHaveBeenCalled();
	} );

	it( 'cleans an extracted ZIP when its Blueprint is invalid', async () => {
		extractBlueprintBundle.mockResolvedValue( {
			blueprintJson: null,
			blueprintJsonPath: '/tmp/extracted/blueprint.json',
			tempDir: '/tmp/extracted',
		} );
		render( <TestUpload /> );
		chooseFile( createFile( 'invalid.zip', 'zip', 'application/zip' ) );

		await waitFor( () =>
			expect( cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/extracted' )
		);
		expect( await screen.findByText( /must be object/ ) ).toBeInTheDocument();
	} );

	it( 'blocks creation until an invalid upload is replaced', async () => {
		const onValidityChange = vi.fn();
		render( <TestUpload onValidityChange={ onValidityChange } /> );
		chooseFile( createFile( 'notes.txt', 'not a blueprint', 'text/plain' ) );

		expect( await screen.findByRole( 'dialog', { name: 'Blueprint error' } ) ).toHaveTextContent(
			'That file type is not supported. Choose a Blueprint JSON file or ZIP bundle.'
		);
		expect( onValidityChange ).toHaveBeenLastCalledWith( false );

		chooseFile(
			createFile(
				'valid.json',
				JSON.stringify( { meta: { title: 'Valid', author: 'Studio' } } ),
				'application/json'
			)
		);
		await waitFor( () => expect( onValidityChange ).toHaveBeenLastCalledWith( true ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Blueprint error' } ) ).not.toBeInTheDocument()
		);
	} );

	it( 'allows an invalid upload to be removed', async () => {
		const onValidityChange = vi.fn();
		render( <TestUpload onValidityChange={ onValidityChange } /> );
		chooseFile( createFile( 'notes.txt', 'not a blueprint', 'text/plain' ) );

		expect( await screen.findByRole( 'dialog', { name: 'Blueprint error' } ) ).toHaveTextContent(
			'That file type is not supported. Choose a Blueprint JSON file or ZIP bundle.'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Blueprint error' } ) ).not.toBeInTheDocument()
		);
		expect( onValidityChange ).toHaveBeenLastCalledWith( true );
		expect( screen.getByRole( 'button', { name: 'upload a file' } ) ).toBeInTheDocument();
	} );

	it( 'replaces ZIP extraction details with a user-friendly error', async () => {
		extractBlueprintBundle.mockRejectedValue(
			new Error(
				"Error invoking remote method 'extractBlueprintBundle': No blueprint.json found in the ZIP file."
			)
		);
		render( <TestUpload /> );
		chooseFile( createFile( 'bundle.zip', 'zip', 'application/zip' ) );

		expect( await screen.findByRole( 'dialog', { name: 'Blueprint error' } ) ).toHaveTextContent(
			'This ZIP could not be used. Make sure it contains a valid blueprint.json file at the top level and try again.'
		);
		expect( screen.queryByText( /Error invoking remote method/ ) ).not.toBeInTheDocument();
	} );

	it( 'cancels and cleans a replacement ZIP when the selection is removed', async () => {
		const onSelect = vi.fn();
		const replacement = deferred< {
			blueprintJson: { meta: { title: string; author: string } };
			blueprintJsonPath: string;
			tempDir: string;
		} >();
		extractBlueprintBundle.mockReturnValue( replacement.promise );
		render( <TestUpload onSelect={ onSelect } /> );
		chooseFile(
			createFile(
				'initial.json',
				JSON.stringify( { meta: { title: 'Initial', author: 'Studio' } } ),
				'application/json'
			)
		);
		await waitFor( () => expect( onSelect ).toHaveBeenCalledOnce() );

		chooseFile( createFile( 'replacement.zip', 'zip', 'application/zip' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'remove' } ) );
		replacement.resolve( {
			blueprintJson: { meta: { title: 'Replacement', author: 'Studio' } },
			blueprintJsonPath: '/tmp/replacement/blueprint.json',
			tempDir: '/tmp/replacement',
		} );

		await waitFor( () =>
			expect( cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/replacement' )
		);
		expect( onSelect ).toHaveBeenCalledOnce();
		expect( screen.getByRole( 'button', { name: 'upload a file' } ) ).toBeInTheDocument();
	} );

	it( 'accepts a full-window file drop', async () => {
		const onSelect = vi.fn();
		render( <TestUpload onSelect={ onSelect } /> );
		const file = createFile( 'dropped.json', '{}', 'application/json' );
		fireEvent.drop( window, {
			dataTransfer: { files: [ file ], types: [ 'Files' ] },
		} );

		await waitFor( () => expect( onSelect ).toHaveBeenCalledOnce() );
	} );

	it( 'clears the full-window overlay when a drag ends without a file', () => {
		render( <TestUpload /> );
		fireEvent.dragEnter( window, { dataTransfer: { files: [], types: [ 'Files' ] } } );
		expect( screen.getByText( 'Drop Blueprint to use it for this site' ) ).toBeInTheDocument();

		fireEvent.drop( window, { dataTransfer: { files: [], types: [] } } );
		expect(
			screen.queryByText( 'Drop Blueprint to use it for this site' )
		).not.toBeInTheDocument();
	} );
} );
