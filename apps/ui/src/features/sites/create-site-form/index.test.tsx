import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useSites } from '@/data/queries/use-sites';
import { useWordPressVersions } from '@/data/queries/use-wordpress-versions';
import { useOffline } from '@/hooks/use-offline';
import { CreateSiteForm } from './index';
import type { CreateSiteFormValues } from './index';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return { ...actual, useConnector: vi.fn() };
} );

vi.mock( '@/components/learn-more', () => ( {
	LearnHowLink: () => null,
	LearnMoreLink: ( { docsLinksKey }: { docsLinksKey: string } ) => (
		<span data-testid={ `learn-more-${ docsLinksKey }` } />
	),
} ) );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	usePathValidator: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-certificate-trust', () => ( {
	useCertificateTrust: () => ( { data: true } ),
	useTrustCertificate: () => ( { mutate: vi.fn(), isPending: false } ),
} ) );

vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	useWordPressVersions: vi.fn(),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const usePathValidatorMock = vi.mocked( usePathValidator, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useWordPressVersionsMock = vi.mocked( useWordPressVersions, { partial: true } );
const useOfflineMock = vi.mocked( useOffline );

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

async function chooseOption( select: string, option: string | RegExp ) {
	await userEvent.click( screen.getByRole( 'combobox', { name: select } ) );
	await userEvent.click( await screen.findByRole( 'option', { name: option } ) );
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
				annotatePreview: false,
				studioLogs: false,
			},
		} );
		useSitesMock.mockReturnValue( { data: [] } );
		useWordPressVersionsMock.mockReturnValue( { data: undefined } );
		useOfflineMock.mockReturnValue( false );
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
		expect( screen.getByRole( 'combobox', { name: 'PHP version' } ) ).toHaveTextContent( '8.3' );
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
		expect( screen.getByTestId( 'create-site-submit' ) ).toBeEnabled();

		await act( async () => {
			pending.resolve( { path: '/sites/suggested', isEmpty: true, isWordPress: false } );
			await pending.promise;
		} );
		await waitFor( () => expect( screen.getByTestId( 'create-site-submit' ) ).toBeEnabled() );
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
		expect( screen.getByRole( 'combobox', { name: 'PHP version' } ) ).toHaveTextContent(
			RecommendedPHPVersion
		);
		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( DEFAULT_WORDPRESS_VERSION );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'manual-admin' );
		expect( screen.getByLabelText( /Admin password/ ) ).toHaveValue( defaultPassword );
		expect( screen.getByLabelText( /Admin email/ ) ).toHaveValue( 'second@example.com' );
		expect( screen.getByRole( 'switch', { name: 'Use custom domain' } ) ).not.toBeChecked();
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
		expect( screen.getByTestId( 'create-site-submit' ) ).toBeEnabled();
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

	it( 'keeps the submit button enabled while typing and queues a submit until the path resolves', async () => {
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
		renderForm( undefined, onSubmit );
		fireEvent.change( screen.getByLabelText( /Site name/ ), {
			target: { value: 'My site' },
		} );
		expect( screen.getByTestId( 'create-site-submit' ) ).toBeEnabled();

		fireEvent.click( screen.getByTestId( 'create-site-submit' ) );
		expect( onSubmit ).not.toHaveBeenCalled();

		await act( async () => {
			pending.resolve( { path: '/sites/my-site', isEmpty: true, isWordPress: false } );
			await pending.promise;
		} );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith(
				expect.objectContaining( { path: '/sites/my-site' } )
			)
		);
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

		await waitFor( () => expect( screen.getByTestId( 'create-site-submit' ) ).toBeEnabled() );
		fireEvent.click( screen.getByTestId( 'create-site-submit' ) );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith(
				expect.objectContaining( { path: '/sites/manual' } )
			)
		);
	} );

	it( 'checks a typed folder, and adds an existing WordPress site as it is', async () => {
		const selectPath = vi.fn( async ( path: string ) => ( {
			path,
			isEmpty: false,
			isWordPress: path === '/sites/wordpress',
			error:
				path === '/sites/wordpress'
					? undefined
					: 'Choose an empty folder or an existing WordPress site.',
		} ) );
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: vi.fn( async () => ( {
				path: '/sites/typed',
				isEmpty: true,
				isWordPress: false,
			} ) ),
			selectPath,
		} );
		const onExistingChange = vi.fn();
		render(
			<CreateSiteForm
				initialValues={ { name: 'Typed' } }
				existingDomainNames={ [] }
				onSubmit={ vi.fn() }
				onCancel={ vi.fn() }
				onExistingChange={ onExistingChange }
			/>
		);
		openAdvancedSettings();
		fireEvent.change( await screen.findByLabelText( 'Local path' ), {
			target: { value: '/sites/full' },
		} );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Local path' ) ).toHaveAccessibleDescription(
				'Choose an empty folder or an existing WordPress site.'
			)
		);
		expect( selectPath ).toHaveBeenCalledOnce();

		fireEvent.change( screen.getByLabelText( 'Local path' ), {
			target: { value: '/sites/wordpress' },
		} );
		expect( await screen.findByText( 'Existing local WordPress site' ) ).toBeVisible();
		expect( screen.queryByLabelText( /Admin username/ ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'switch', { name: 'Use custom domain' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'WordPress version' ) ).not.toBeInTheDocument();

		expect( onExistingChange ).toHaveBeenLastCalledWith( true );
	} );

	it( 'opens Advanced settings on its own for a folder it cannot use', async () => {
		usePathValidatorMock.mockReturnValue( {
			generateProposedPath: vi.fn( async () => ( {
				path: '/sites/full',
				isEmpty: false,
				isWordPress: false,
				error: 'Choose an empty folder or an existing WordPress site.',
			} ) ),
			selectPath: vi.fn(),
		} );
		renderForm( { name: 'Full' } );

		expect( screen.getByRole( 'textbox', { name: /Site name/ } ) ).toHaveFocus();
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: /Advanced settings/ } ) ).toHaveAttribute(
				'aria-expanded',
				'true'
			)
		);
		expect( screen.getByLabelText( 'Local path' ) ).toHaveAccessibleDescription(
			'Choose an empty folder or an existing WordPress site.'
		);
	} );

	it( 'offers file access choices without a PHP runtime choice', async () => {
		const onSubmit = vi.fn();
		renderForm( { name: 'Runtime' }, onSubmit );
		openAdvancedSettings();
		expect( screen.queryByRole( 'combobox', { name: /runtime/i } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'combobox', { name: 'File access' } ) ).toHaveTextContent(
			'Site directory'
		);
		await chooseOption( 'File access', /^All files/ );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Local path' ) ).toHaveValue( '/sites/Runtime' )
		);
		fireEvent.click( screen.getByTestId( 'create-site-submit' ) );
		expect( onSubmit ).toHaveBeenCalledWith(
			expect.objectContaining( { fileAccess: 'all-files' } )
		);
		expect( onSubmit.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'runtime' );
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
		expect( screen.getByTestId( 'create-site-submit' ) ).toBeDisabled();
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
		expect( screen.getByTestId( 'create-site-submit' ) ).toBeDisabled();
	} );

	it( 'marks a focused folder picker invalid as soon as selection validation fails', async () => {
		useConnectorMock.mockReturnValue( {
			capabilities: {
				nativeFolderPicker: true,
				annotatePreview: false,
				studioLogs: false,
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

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			'That path is already in use.'
		);
		expect( pathTrigger ).toHaveFocus();
		expect( screen.getByLabelText( 'Local path' ) ).toBeInvalid();
		expect( screen.getByLabelText( 'Local path' ) ).toHaveAccessibleDescription(
			'That path is already in use.'
		);
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

		// Auto-update is the default, so no version is pinned.
		await waitFor( () =>
			expect( screen.getByRole( 'combobox', { name: 'WordPress version' } ) ).toHaveTextContent(
				'Auto-update (6.8)'
			)
		);
	} );

	it.each( [ '6.5', '6.5.5' ] )(
		"pins a suggested %s to its branch's newest release",
		async ( wpVersion ) => {
			useWordPressVersionsMock.mockReturnValue( {
				data: [
					{ label: '6.8', value: 'latest', isBeta: false, isDevelopment: false },
					{ label: '6.8.1', value: '6.8.1', isBeta: false, isDevelopment: false },
					{ label: '6.5.13', value: '6.5.13', isBeta: false, isDevelopment: false },
				],
			} );
			renderForm( { name: 'Old Blueprint', wpVersion } );
			openAdvancedSettings();

			await waitFor( () =>
				expect( screen.getByRole( 'combobox', { name: 'WordPress version' } ) ).toHaveTextContent(
					'6.5.13'
				)
			);
		}
	);

	it( "says when a suggested WordPress version can't be installed", async () => {
		useWordPressVersionsMock.mockReturnValue( {
			data: [
				{ label: '6.8', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.8.1', value: '6.8.1', isBeta: false, isDevelopment: false },
			],
		} );
		renderForm( { name: 'Old Blueprint', wpVersion: '5.9' } );
		openAdvancedSettings();

		expect(
			await screen.findByText(
				"This Blueprint asks for WordPress 5.9, which WordPress Studio can't install."
			)
		).toBeVisible();
		expect( screen.getByRole( 'combobox', { name: 'WordPress version' } ) ).toHaveTextContent(
			'Auto-update (6.8)'
		);
	} );

	// The site does not exist yet, so the description names the version it will
	// be created with rather than claiming one is already in use; it describes
	// the option, so it holds while a pinned version is selected.
	it( 'names the version a new site will be created with', async () => {
		useWordPressVersionsMock.mockReturnValue( {
			data: [
				{ label: '6.9', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '7.0-beta1', value: '7.0-beta1', isBeta: true, isDevelopment: false },
				{ label: '6.9', value: '6.9', isBeta: false, isDevelopment: false },
			],
		} );
		const onSubmit = vi.fn();
		renderForm( { name: 'New site' }, onSubmit );
		openAdvancedSettings();

		await chooseOption( 'WordPress version', '7.0-beta1' );
		await userEvent.click( screen.getByRole( 'combobox', { name: 'WordPress version' } ) );
		expect(
			await screen.findByRole( 'option', { name: /Auto-update \(6\.9\)/ } )
		).toHaveTextContent(
			'WordPress installs updates on its own schedule. Will install version 6.9.'
		);
		expect( screen.getByRole( 'group', { name: 'Beta & Nightly' } ) ).toBeInTheDocument();
		await userEvent.keyboard( '{Escape}' );

		await waitFor( () => expect( screen.getByTestId( 'create-site-submit' ) ).toBeEnabled() );
		fireEvent.click( screen.getByTestId( 'create-site-submit' ) );
		expect( onSubmit ).toHaveBeenCalledWith(
			expect.objectContaining( { wpVersion: '7.0-beta1' } )
		);
	} );

	it( 'locks the WordPress version to a disabled "latest" select while offline', async () => {
		useOfflineMock.mockReturnValue( true );
		renderForm( { name: 'Offline site', wpVersion: '6.7' } );
		openAdvancedSettings();

		const select = screen.getByRole( 'combobox', { name: 'WordPress version' } );
		expect( select ).toBeDisabled();
		await waitFor( () => expect( select ).toHaveTextContent( 'Auto-update' ) );

		const trigger = select.closest( 'div[style*="pointer-events"]' )?.parentElement as HTMLElement;
		fireEvent.mouseEnter( trigger );
		fireEvent.mouseMove( trigger, { movementX: 1, movementY: 1 } );
		// Tooltips use Base UI's default open delay, so wait long enough for the popup.
		expect(
			await screen.findByText(
				'Changing WordPress version requires an internet connection.',
				{},
				{ timeout: 2000 }
			)
		).toBeVisible();
	} );

	it( 'requires a site name once it has been edited', () => {
		renderForm( { name: 'Named site' } );
		expect( screen.queryByText( 'Site name is required.' ) ).not.toBeInTheDocument();

		fireEvent.change( screen.getByLabelText( /Site name/ ), { target: { value: ' ' } } );
		expect( screen.getByLabelText( /Site name/ ) ).toHaveAccessibleDescription(
			'Site name is required.'
		);
		expect( screen.getByTestId( 'create-site-submit' ) ).toBeDisabled();
	} );

	it( 'counts errors in the collapsed advanced settings', async () => {
		renderForm( { name: 'Site', adminEmail: 'not-an-email' } );

		expect( screen.getByText( '1 error found' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'create-site-submit' ) ).toBeDisabled();
		openAdvancedSettings();
		expect( screen.getByLabelText( /Admin email/ ) ).toHaveAccessibleDescription(
			'Please enter a valid email address.'
		);
	} );

	it( 'supports an external submission gate', async () => {
		renderForm( { name: 'Blocked site' }, vi.fn(), true );

		await waitFor( () => expect( screen.getByTestId( 'create-site-submit' ) ).toBeDisabled() );
	} );

	it( 'shows an actionable submission error with optional technical details', () => {
		const onCancel = vi.fn();
		render(
			<CreateSiteForm
				initialValues={ { name: 'Imported site', path: '/sites/imported-site' } }
				existingDomainNames={ [] }
				onSubmit={ vi.fn() }
				onCancel={ onCancel }
				submitLabel="Retry import"
				cancelLabel="Choose another backup"
				submitError={ {
					title: 'WordPress Studio could not import this backup.',
					message: 'The incomplete site was removed.',
					details: 'CLI command failed',
				} }
			/>
		);

		const alert = screen.getByRole( 'alert' );
		expect( alert ).toHaveTextContent( 'WordPress Studio could not import this backup.' );
		expect( alert ).toHaveTextContent( 'The incomplete site was removed.' );
		expect( screen.getByRole( 'button', { name: 'Retry import' } ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Choose another backup' } ) );
		expect( onCancel ).toHaveBeenCalledOnce();

		fireEvent.click( screen.getByText( 'View technical details' ) );
		expect( screen.getByText( 'CLI command failed' ) ).toBeVisible();
	} );
} );
