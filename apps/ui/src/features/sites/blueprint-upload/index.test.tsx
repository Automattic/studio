import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileDrop } from '@/data/use-composer-attachments';
import { BlueprintErrorDialog } from '@/features/sites/blueprint-error-dialog';
import { createFakeConnector, type FakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { useBlueprintUpload } from './use-blueprint-upload';
import { SiteFileUpload } from './index';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';

let connector: FakeConnector;

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
	const upload = useBlueprintUpload( { enabled: true, onSelect, onValidityChange } );
	const [ target, setTarget ] = useState< HTMLDivElement | null >( null );
	useFileDrop( target, ( files ) => {
		if ( files[ 0 ] ) void upload.handleFile( files[ 0 ] );
	} );
	return (
		<div ref={ setTarget }>
			<SiteFileUpload onFile={ upload.handleFile } />
			<BlueprintErrorDialog error={ upload.error } onDismiss={ upload.dismissError } />
		</div>
	);
}

async function renderUpload( props: Parameters< typeof TestUpload >[ 0 ] = {} ) {
	const view = renderWithProviders( <TestUpload { ...props } />, { connector } );
	await screen.findByRole( 'button', { name: 'Choose file' } );
	return view;
}

function chooseFile( file: File ) {
	const input = document.querySelector< HTMLInputElement >( 'input[type="file"]' );
	if ( ! input ) throw new Error( 'File input not found' );
	fireEvent.change( input, { target: { files: [ file ] } } );
}

describe( 'SiteFileUpload', () => {
	beforeEach( () => {
		connector = createFakeConnector();
	} );

	it( 'selects a JSON Blueprint', async () => {
		const onSelect = vi.fn();
		await renderUpload( { onSelect } );
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
	} );

	it( 'reports a stalled upload and discards its late result', async () => {
		const onSelect = vi.fn();
		const pending = deferred< Awaited< ReturnType< typeof connector.extractBlueprintBundle > > >();
		connector.extractBlueprintBundle.mockReturnValueOnce( pending.promise );
		await renderUpload( { onSelect } );
		vi.useFakeTimers();
		try {
			chooseFile( createFile( 'bundle.zip', 'zip', 'application/zip' ) );
			await act( async () => vi.advanceTimersByTime( 60_000 ) );
			expect(
				screen.getByText(
					'This file took too long to load. Please try again or choose another file.'
				)
			).toBeVisible();
			await act( async () =>
				pending.resolve( {
					blueprintJson: {},
					blueprintJsonPath: '/tmp/late/blueprint.json',
					tempDir: '/tmp/late',
				} )
			);
			expect( onSelect ).not.toHaveBeenCalled();
			expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/late' );
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'extracts a ZIP Blueprint and keeps its temporary-file metadata', async () => {
		const onSelect = vi.fn();
		connector.extractBlueprintBundle.mockResolvedValue( {
			blueprintJson: { meta: { title: 'Bundled Blueprint', author: 'Studio' } },
			blueprintJsonPath: '/tmp/extracted/blueprint.json',
			tempDir: '/tmp/extracted',
		} );
		await renderUpload( { onSelect } );
		chooseFile( createFile( 'bundle.zip', 'zip', 'application/zip' ) );

		await waitFor( () => expect( onSelect ).toHaveBeenCalledOnce() );
		expect( connector.extractBlueprintBundle ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'bundle.zip' } )
		);
		expect( onSelect.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			filePath: '/tmp/extracted/blueprint.json',
			tempDir: '/tmp/extracted',
		} );
		expect( connector.cleanupBlueprintTempDir ).not.toHaveBeenCalled();
	} );

	it( 'cleans an extracted ZIP when its Blueprint is invalid', async () => {
		connector.extractBlueprintBundle.mockResolvedValue( {
			blueprintJson: null as never,
			blueprintJsonPath: '/tmp/extracted/blueprint.json',
			tempDir: '/tmp/extracted',
		} );
		await renderUpload();
		chooseFile( createFile( 'invalid.zip', 'zip', 'application/zip' ) );

		await waitFor( () =>
			expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/extracted' )
		);
		expect( await screen.findByText( /must be object/ ) ).toBeInTheDocument();
	} );

	it( 'restores validity after a failed upload', async () => {
		const onValidityChange = vi.fn();
		await renderUpload( { onValidityChange } );
		chooseFile( createFile( 'notes.txt', 'not a blueprint', 'text/plain' ) );

		expect( await screen.findByRole( 'dialog', { name: 'Blueprint error' } ) ).toHaveTextContent(
			'That file type is not supported. Choose a Blueprint, WordPress backup, or XML export file.'
		);
		expect( onValidityChange ).toHaveBeenLastCalledWith( true );

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
		await renderUpload( { onValidityChange } );
		chooseFile( createFile( 'notes.txt', 'not a blueprint', 'text/plain' ) );

		expect( await screen.findByRole( 'dialog', { name: 'Blueprint error' } ) ).toHaveTextContent(
			'That file type is not supported. Choose a Blueprint, WordPress backup, or XML export file.'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Blueprint error' } ) ).not.toBeInTheDocument()
		);
		expect( onValidityChange ).toHaveBeenLastCalledWith( true );
		expect( screen.getByRole( 'button', { name: 'Choose file' } ) ).toBeInTheDocument();
	} );

	it( 'replaces ZIP extraction details with a user-friendly error', async () => {
		connector.extractBlueprintBundle.mockRejectedValue(
			new Error(
				"Error invoking remote method 'extractBlueprintBundle': No blueprint.json found in the ZIP file."
			)
		);
		await renderUpload();
		chooseFile( createFile( 'bundle.zip', 'zip', 'application/zip' ) );

		expect( await screen.findByRole( 'dialog', { name: 'Blueprint error' } ) ).toHaveTextContent(
			'This ZIP could not be used. Make sure it contains a valid blueprint.json file at the top level or inside one enclosing folder, and try again.'
		);
		expect( screen.queryByText( /Error invoking remote method/ ) ).not.toBeInTheDocument();
	} );

	it( 'cancels and cleans a ZIP still extracting when unmounted', async () => {
		const onSelect = vi.fn();
		const extraction = deferred< {
			blueprintJson: { meta: { title: string; author: string } };
			blueprintJsonPath: string;
			tempDir: string;
		} >();
		connector.extractBlueprintBundle.mockReturnValue( extraction.promise );
		const { unmount } = await renderUpload( { onSelect } );
		chooseFile( createFile( 'bundle.zip', 'zip', 'application/zip' ) );
		unmount();
		extraction.resolve( {
			blueprintJson: { meta: { title: 'Bundled', author: 'Studio' } },
			blueprintJsonPath: '/tmp/bundle/blueprint.json',
			tempDir: '/tmp/bundle',
		} );

		await waitFor( () =>
			expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/bundle' )
		);
		expect( onSelect ).not.toHaveBeenCalled();
	} );

	it( 'accepts a dropped Blueprint only inside the upload target', async () => {
		const onSelect = vi.fn();
		await renderUpload( { onSelect } );
		const dataTransfer = {
			files: [ createFile( 'dropped.json', '{}', 'application/json' ) ],
			types: [ 'Files' ],
		};
		fireEvent.drop( window, { dataTransfer } );
		expect( onSelect ).not.toHaveBeenCalled();
		fireEvent.drop( screen.getByText( 'Drop your file here' ).parentElement!.parentElement!, {
			dataTransfer,
		} );
		await waitFor( () => expect( onSelect ).toHaveBeenCalledOnce() );
	} );
} );
