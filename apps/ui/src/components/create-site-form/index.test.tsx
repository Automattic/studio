import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
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

function renderForm(
	initialValues?: Partial< CreateSiteFormValues >,
	onSubmit = vi.fn(),
	isSubmitDisabled = false,
	isSubmitting = false
) {
	const props = {
		initialValues,
		existingDomainNames: [],
		onSubmit,
		onCancel: vi.fn(),
		isSubmitDisabled,
		isSubmitting,
	};
	const result = render( <CreateSiteForm { ...props } /> );
	return {
		...result,
		rerenderWith: (
			nextInitialValues?: Partial< CreateSiteFormValues >,
			nextIsSubmitting = isSubmitting
		) =>
			result.rerender(
				<CreateSiteForm
					{ ...props }
					initialValues={ nextInitialValues }
					isSubmitting={ nextIsSubmitting }
				/>
			),
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
				siteCheckpoints: false,
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

	it( 'keeps path validation pending while an asynchronous name suggestion resolves', async () => {
		const pending = deferred< {
			path: string;
			isEmpty: boolean;
			isWordPress: boolean;
		} >();
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: vi.fn( () => pending.promise ),
			selectPath: vi.fn(),
		} );
		const { rerenderWith } = renderForm();
		expect( screen.queryByText( '1 error found' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Please fill out this field.' ) ).not.toBeInTheDocument();

		rerenderWith( { name: 'Suggested site' } );
		expect( screen.queryByText( '1 error found' ) ).not.toBeInTheDocument();
		expect( screen.getByTestId( 'create-site-submit' ) ).toHaveAttribute( 'aria-disabled', 'true' );

		await act( async () => {
			pending.resolve( { path: '/sites/suggested', isEmpty: true, isWordPress: false } );
			await pending.promise;
		} );
		await waitFor( () =>
			expect( screen.getByTestId( 'create-site-submit' ) ).toHaveAttribute(
				'aria-disabled',
				'false'
			)
		);
	} );

	it( 'replaces previous suggestions and restores defaults without overwriting edits', async () => {
		const { rerenderWith } = renderForm( { name: 'Suggested site' } );
		openAdvancedSettings();
		const defaultPassword = ( screen.getByLabelText( /Admin password/ ) as HTMLInputElement ).value;

		rerenderWith( {
			name: 'First Blueprint',
			path: '/sites/first-blueprint',
			phpVersion: '8.2',
			wpVersion: '6.7',
			customDomain: 'first.local',
			enableHttps: true,
			adminUsername: 'first-admin',
			adminPassword: 'first-password',
			adminEmail: 'first@example.com',
		} );
		fireEvent.change( screen.getByLabelText( /Admin username/ ), {
			target: { value: 'manual-admin' },
		} );

		rerenderWith( {
			name: 'Second Blueprint',
			adminEmail: 'second@example.com',
		} );

		expect( screen.getByLabelText( /Site name/ ) ).toHaveValue( 'Second Blueprint' );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Local path' ) ).toHaveValue( '/sites/Second Blueprint' )
		);
		expect( screen.getByLabelText( 'PHP version' ) ).toHaveValue( RecommendedPHPVersion );
		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( DEFAULT_WORDPRESS_VERSION );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'manual-admin' );
		expect( screen.getByLabelText( /Admin password/ ) ).toHaveValue( defaultPassword );
		expect( screen.getByLabelText( /Admin email/ ) ).toHaveValue( 'second@example.com' );
		expect( screen.getByRole( 'checkbox', { name: 'Use custom domain' } ) ).not.toBeChecked();
		expect( screen.queryByLabelText( 'Domain name' ) ).not.toBeInTheDocument();

		rerenderWith( { name: 'Suggested site' } );
		expect( screen.getByLabelText( /Site name/ ) ).toHaveValue( 'Suggested site' );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'manual-admin' );
		expect( screen.getByLabelText( /Admin email/ ) ).toHaveValue( 'admin@localhost.com' );
	} );

	it( 'shows validation errors from asynchronous suggestions', async () => {
		const { rerenderWith } = renderForm( { name: 'Blueprint site' } );
		rerenderWith( {
			name: 'Blueprint site',
			customDomain: 'example.com',
		} );
		openAdvancedSettings();

		expect( await screen.findByText( 'The domain name must end with .local' ) ).toBeInTheDocument();
		const domainInput = screen.getByLabelText( 'Domain name' );
		expect( domainInput ).toBeInvalid();

		fireEvent.change( domainInput, { target: { value: 'example.local' } } );
		await waitFor( () => expect( domainInput ).toBeValid() );
		expect( screen.queryByText( 'The domain name must end with .local' ) ).not.toBeInTheDocument();
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
		expect( screen.getByTestId( 'create-site-submit' ) ).toHaveAttribute( 'aria-disabled', 'true' );
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

	it( 'does not regenerate the path while navigation after submission completes', async () => {
		const initialGenerator = vi.fn( async () => ( {
			path: '/sites/created-site',
			isEmpty: true,
			isWordPress: false,
		} ) );
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: initialGenerator,
			selectPath: vi.fn(),
		} );
		const { rerenderWith } = renderForm( { name: 'Created site' } );
		await waitFor( () => expect( initialGenerator ).toHaveBeenCalledOnce() );
		openAdvancedSettings();
		await waitFor( () =>
			expect( screen.getByLabelText( 'Local path' ) ).toHaveValue( '/sites/created-site' )
		);

		const refreshedGenerator = vi.fn( async () => ( {
			path: '/sites/created-site-2',
			isEmpty: true,
			isWordPress: false,
		} ) );
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: refreshedGenerator,
			selectPath: vi.fn(),
		} );
		rerenderWith( { name: 'Created site' }, true );

		expect( refreshedGenerator ).not.toHaveBeenCalled();
		expect( screen.getByLabelText( 'Local path' ) ).toHaveValue( '/sites/created-site' );
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

	it( 'marks a focused folder picker invalid as soon as selection validation fails', async () => {
		useConnectorMock.mockReturnValue( {
			capabilities: {
				nativeFolderPicker: true,
				nativeSaveDialog: false,
				siteCheckpoints: false,
				openInOS: false,
				annotatePreview: false,
				readLocalMedia: false,
			},
		} );
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: vi.fn(),
			selectPath: vi.fn( async () => ( {
				path: '/sites/taken',
				isEmpty: false,
				isWordPress: false,
				error: 'That path is already in use.',
			} ) ),
		} );
		renderForm();
		openAdvancedSettings();
		const pathTrigger = screen.getByRole( 'button', { name: 'Select a folder' } );
		pathTrigger.focus();
		fireEvent.click( pathTrigger );

		const error = await screen.findByText( 'That path is already in use.' );
		expect( error ).toHaveClass( 'components-validated-control__indicator', 'is-invalid' );
		expect( pathTrigger ).toHaveFocus();
		expect( pathTrigger ).toHaveAttribute( 'aria-invalid', 'true' );
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

	it( 'uses a stable select control for long WordPress version lists', () => {
		useWordPressVersionsMock.mockReturnValue( {
			data: [
				{ label: 'latest', value: 'latest', isBeta: false, isDevelopment: false },
				...Array.from( { length: 12 }, ( _, index ) => ( {
					label: `6.${ index }`,
					value: `6.${ index }`,
					isBeta: false,
					isDevelopment: false,
				} ) ),
			],
		} );
		renderForm( { name: 'Versioned site' } );
		openAdvancedSettings();

		expect( screen.getByLabelText( 'WordPress version' ).tagName ).toBe( 'SELECT' );
	} );

	it( 'supports an external submission gate', async () => {
		renderForm( { name: 'Blocked site' }, vi.fn(), true );

		await waitFor( () =>
			expect( screen.getByTestId( 'create-site-submit' ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			)
		);
	} );
} );
