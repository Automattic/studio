import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingBackupSlot } from '@/lib/pending-backup';
import { OnboardingHomePage } from './index';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn(),
	hasSites: false,
} ) );

vi.mock( '@tanstack/react-router', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@tanstack/react-router') >();
	return {
		...actual,
		Link: ( { to, children, ...props }: ComponentProps< 'a' > & { to: string } ) => (
			<a href={ to } { ...props }>
				{ children }
			</a>
		),
		useNavigate: () => mocks.navigate,
	};
} );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: mocks.hasSites ? [ { id: 'site-1' } ] : [] } ),
} ) );

describe( 'OnboardingHomePage', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.hasSites = false;
		const pendingFile = pendingBackupSlot.getSnapshot();
		if ( pendingFile ) pendingBackupSlot.clear( pendingFile );
	} );

	it( 'shows the Create and Import jobs', () => {
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'heading', { name: 'Add a site' } ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Start fresh or bring an existing site into your Studio.' )
		).toBeInTheDocument();
		expect( screen.getByRole( 'link', { name: /Create a new site/ } ) ).toHaveAttribute(
			'href',
			'/onboarding/create'
		);
		expect( screen.getByRole( 'button', { name: /Import from a backup/ } ) ).toBeEnabled();
		expect( screen.queryByText( 'Connect a site' ) ).not.toBeInTheDocument();
	} );

	it( 'opens the file picker from the Import card', () => {
		const { container } = render( <OnboardingHomePage /> );
		const input = container.querySelector< HTMLInputElement >( 'input[type="file"]' );
		if ( ! input ) throw new Error( 'Backup input not found' );
		const click = vi.spyOn( input, 'click' );

		fireEvent.click( screen.getByRole( 'button', { name: /Import from a backup/ } ) );

		expect( click ).toHaveBeenCalledOnce();
		expect( input.accept ).toContain( '.sql' );
	} );

	it( 'hands a selected backup File to the import form', () => {
		const { container } = render( <OnboardingHomePage /> );
		const input = container.querySelector< HTMLInputElement >( 'input[type="file"]' );
		if ( ! input ) throw new Error( 'Backup input not found' );
		const file = new File( [ 'backup' ], 'client-site.sql' );

		fireEvent.change( input, { target: { files: [ file ] } } );

		expect( pendingBackupSlot.getSnapshot() ).toBe( file );
		expect( mocks.navigate ).toHaveBeenCalledWith( { to: '/onboarding/import' } );
	} );

	it( 'hands a dropped backup File to the import form', () => {
		render( <OnboardingHomePage /> );
		const file = new File( [ 'backup' ], 'client-site.wpress' );

		fireEvent.drop( screen.getByRole( 'button', { name: /Import from a backup/ } ), {
			dataTransfer: { files: [ file ] },
		} );

		expect( pendingBackupSlot.getSnapshot() ).toBe( file );
		expect( mocks.navigate ).toHaveBeenCalledWith( { to: '/onboarding/import' } );
	} );

	it( 'keeps the drag state while moving across the Import card contents', () => {
		render( <OnboardingHomePage /> );
		const importCard = screen.getByRole( 'button', { name: /Import from a backup/ } );
		const cardContents = screen.getByText( 'Import from a backup' );

		fireEvent.dragOver( importCard );
		const draggingClassName = importCard.className;
		const childDragLeave = new Event( 'dragleave', { bubbles: true, cancelable: true } );
		Object.defineProperty( childDragLeave, 'relatedTarget', { value: cardContents } );
		fireEvent( importCard, childDragLeave );

		expect( importCard ).toHaveClass( draggingClassName, { exact: true } );

		fireEvent.dragLeave( importCard );
		expect( importCard ).not.toHaveClass( draggingClassName, { exact: true } );
	} );

	it( 'rejects unsupported selected and dropped files', () => {
		const { container } = render( <OnboardingHomePage /> );
		const input = container.querySelector< HTMLInputElement >( 'input[type="file"]' );
		if ( ! input ) throw new Error( 'Backup input not found' );
		const importCard = screen.getByRole( 'button', { name: /Import from a backup/ } );

		fireEvent.change( input, {
			target: { files: [ new File( [ 'text' ], 'notes.txt' ) ] },
		} );
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'This file type is not supported' );

		fireEvent.drop( importCard, {
			dataTransfer: { files: [ new File( [ 'image' ], 'screenshot.png' ) ] },
		} );
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'This file type is not supported' );
		expect( pendingBackupSlot.getSnapshot() ).toBeNull();
		expect( mocks.navigate ).not.toHaveBeenCalled();
	} );

	it( 'shows Back when onboarding was opened from an existing site', () => {
		mocks.hasSites = true;
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toBeInTheDocument();
	} );
} );
