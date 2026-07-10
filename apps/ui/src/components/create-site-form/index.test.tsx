import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useSites } from '@/data/queries/use-sites';
import { useWordPressVersions } from '@/data/queries/use-wordpress-versions';
import { CreateSiteForm } from './index';
import type { CreateSiteFormValues } from './index';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return { ...actual, useConnector: vi.fn() };
} );

vi.mock( '@/components/learn-more', () => ( {
	LearnHowLink: () => null,
	LearnMoreLink: () => null,
} ) );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	usePathValidator: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	useWordPressVersions: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const usePathValidatorMock = vi.mocked( usePathValidator, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useWordPressVersionsMock = vi.mocked( useWordPressVersions, { partial: true } );

function deferred< T >() {
	let resolve!: ( value: T ) => void;
	let reject!: ( reason?: unknown ) => void;
	const promise = new Promise< T >( ( promiseResolve, promiseReject ) => {
		resolve = promiseResolve;
		reject = promiseReject;
	} );
	return { promise, resolve, reject };
}

function renderForm( initialValues?: Partial< CreateSiteFormValues >, onSubmit = vi.fn() ) {
	const props = {
		initialValues,
		existingDomainNames: [],
		onSubmit,
		onCancel: vi.fn(),
	};
	const result = render( <CreateSiteForm { ...props } /> );
	return {
		...result,
		rerenderWith: ( nextInitialValues?: Partial< CreateSiteFormValues > ) =>
			result.rerender( <CreateSiteForm { ...props } initialValues={ nextInitialValues } /> ),
	};
}

function openAdvancedSettings() {
	fireEvent.click( screen.getByRole( 'button', { name: /Advanced settings/ } ) );
}

describe( 'CreateSiteForm', () => {
	beforeAll( () => {
		Object.defineProperty( window, 'matchMedia', {
			writable: true,
			value: vi.fn().mockImplementation( ( query: string ) => ( {
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			} ) ),
		} );
	} );

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( {
			capabilities: {
				nativeFolderPicker: false,
				nativeSaveDialog: false,
				openInOS: false,
				annotatePreview: false,
				readLocalMedia: false,
			},
		} );
		useSitesMock.mockReturnValue( { data: [] } );
		useWordPressVersionsMock.mockReturnValue( { data: undefined } );
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: vi.fn( async ( name: string ) => ( {
				path: `/sites/${ name }`,
				isEmpty: true,
				isWordPress: false,
			} ) ),
			selectPath: vi.fn(),
		} );
	} );

	it( 'applies asynchronous suggestions only to fields the user has not edited', async () => {
		const { rerenderWith } = renderForm();
		fireEvent.change( screen.getByLabelText( /Site name/ ), {
			target: { value: 'My manual name' },
		} );
		openAdvancedSettings();
		fireEvent.change( screen.getByLabelText( 'WordPress version' ), {
			target: { value: '6.8' },
		} );

		rerenderWith( {
			name: 'Blueprint name',
			phpVersion: '8.3',
			wpVersion: '6.7',
			adminUsername: 'blueprint-admin',
		} );

		expect( screen.getByLabelText( /Site name/ ) ).toHaveValue( 'My manual name' );
		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( '6.8' );
		expect( screen.getByLabelText( 'PHP version' ) ).toHaveValue( '8.3' );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'blueprint-admin' );
	} );

	it( 'ignores a stale generated path after the site name changes', async () => {
		const first = deferred< {
			path: string;
			isEmpty: boolean;
			isWordPress: boolean;
		} >();
		const second = deferred< {
			path: string;
			isEmpty: boolean;
			isWordPress: boolean;
		} >();
		const generateProposedPath = vi
			.fn()
			.mockReturnValueOnce( first.promise )
			.mockReturnValueOnce( second.promise );
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath,
			selectPath: vi.fn(),
		} );

		renderForm( { name: 'First' } );
		await waitFor( () => expect( generateProposedPath ).toHaveBeenCalledWith( 'First' ) );
		fireEvent.change( screen.getByLabelText( /Site name/ ), { target: { value: 'Second' } } );
		await waitFor( () => expect( generateProposedPath ).toHaveBeenCalledWith( 'Second' ) );

		await act( async () => {
			second.resolve( { path: '/sites/second', isEmpty: true, isWordPress: false } );
			await second.promise;
		} );
		openAdvancedSettings();
		expect( screen.getByLabelText( 'Local path' ) ).toHaveValue( '/sites/second' );

		await act( async () => {
			first.resolve( { path: '/sites/first', isEmpty: true, isWordPress: false } );
			await first.promise;
		} );
		expect( screen.getByLabelText( 'Local path' ) ).toHaveValue( '/sites/second' );
	} );

	it( 'preserves a manual path when automatic generation is still pending', async () => {
		const pending = deferred< {
			path: string;
			isEmpty: boolean;
			isWordPress: boolean;
		} >();
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: vi.fn( () => pending.promise ),
			selectPath: vi.fn(),
		} );
		const onSubmit = vi.fn();
		renderForm( { name: 'Pending' }, onSubmit );
		openAdvancedSettings();
		fireEvent.change( screen.getByLabelText( 'Local path' ), {
			target: { value: '/sites/manual' },
		} );

		await act( async () => {
			pending.resolve( { path: '/sites/generated', isEmpty: true, isWordPress: false } );
			await pending.promise;
		} );
		expect( screen.getByLabelText( 'Local path' ) ).toHaveValue( '/sites/manual' );

		await waitFor( () =>
			expect( screen.getByTestId( 'create-site-submit' ) ).toHaveAttribute(
				'aria-disabled',
				'false'
			)
		);
		fireEvent.click( screen.getByTestId( 'create-site-submit' ) );
		expect( onSubmit ).toHaveBeenCalledWith( expect.objectContaining( { path: '/sites/manual' } ) );
	} );

	it( 'surfaces path validation and generation errors without leaving the form pending', async () => {
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: vi.fn( async () => ( {
				path: '/sites/taken',
				isEmpty: false,
				isWordPress: false,
				error: 'That path is already in use.',
			} ) ),
			selectPath: vi.fn(),
		} );
		const { unmount } = renderForm( { name: 'Taken' } );
		openAdvancedSettings();
		expect( await screen.findByText( 'That path is already in use.' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'create-site-submit' ) ).toHaveAttribute( 'aria-disabled', 'true' );
		unmount();

		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: vi.fn( async () => {
				throw new Error( 'offline' );
			} ),
			selectPath: vi.fn(),
		} );
		renderForm( { name: 'Unavailable' } );
		openAdvancedSettings();
		expect(
			await screen.findByText( 'Unable to suggest a folder for this site name.' )
		).toBeInTheDocument();
		expect( screen.getByTestId( 'create-site-submit' ) ).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'falls back to the default WordPress version when a suggestion is unsupported', async () => {
		useWordPressVersionsMock.mockReturnValue( {
			data: [
				{ label: '6.8', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.8', value: '6.8', isBeta: false, isDevelopment: false },
			],
		} );
		renderForm( { name: 'Old Blueprint', wpVersion: '4.9' } );
		openAdvancedSettings();

		await waitFor( () =>
			expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( 'latest' )
		);
	} );
} );
