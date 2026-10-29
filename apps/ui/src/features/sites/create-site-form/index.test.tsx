import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_CAPABILITIES, createFakeConnector, type FakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { CreateSiteForm } from './index';

type Props = ComponentProps< typeof CreateSiteForm >;
type ProposedPath = { path: string; isEmpty: boolean; isWordPress: boolean };

function deferred< T >() {
	let resolve!: ( value: T ) => void;
	const promise = new Promise< T >( ( done ) => ( resolve = done ) );
	return { promise, resolve: ( value: T ) => act( async () => resolve( value ) ) };
}

const versions = ( ...labels: [ string, string ][] ) =>
	labels.map( ( [ label, value ] ) => ( {
		label,
		value,
		isBeta: label.includes( 'beta' ),
		isDevelopment: false,
	} ) );

async function renderForm(
	initialProps: Partial< Props > = {},
	connector: FakeConnector = createFakeConnector(
		{},
		{
			capabilities: {
				...ALL_CAPABILITIES,
				nativeFolderPicker: false,
				annotatePreview: false,
				studioLogs: false,
			},
		}
	)
) {
	const onSubmit = vi.fn();
	const onCancel = vi.fn();
	let setProps!: ( props: Partial< Props > ) => void;
	function Harness() {
		const [ props, set ] = useState( initialProps );
		setProps = ( next ) => set( ( previous ) => ( { ...previous, ...next } ) );
		return (
			<CreateSiteForm
				existingDomainNames={ [] }
				onSubmit={ onSubmit }
				onCancel={ onCancel }
				{ ...props }
			/>
		);
	}
	const view = renderWithProviders( <Harness />, { connector } );
	await screen.findByRole( 'textbox', { name: /Site name/ } );
	return {
		...view,
		connector,
		onSubmit,
		onCancel,
		update: ( props: Partial< Props > ) => act( () => setProps( props ) ),
	};
}

const siteName = () => screen.getByRole( 'textbox', { name: /Site name/ } );
const localPath = () => screen.getByLabelText( 'Local path' );
const submitButton = () => screen.getByTestId( 'create-site-submit' );
const advanced = () =>
	fireEvent.click( screen.getByRole( 'button', { name: /Advanced settings/ } ) );

async function chooseOption( select: string, option: string | RegExp ) {
	fireEvent.click( screen.getByRole( 'combobox', { name: select } ) );
	const item = await screen.findByRole( 'option', { name: option } );
	fireEvent.pointerDown( item, { pointerType: 'mouse' } );
	fireEvent.click( item );
}

afterEach( () => vi.restoreAllMocks() );

describe( 'CreateSiteForm suggestions', () => {
	it( 'applies later suggestions only to the fields the user has not edited', async () => {
		const { update } = await renderForm();
		fireEvent.change( siteName(), { target: { value: 'My manual name' } } );
		advanced();
		fireEvent.change( screen.getByLabelText( 'WordPress version' ), { target: { value: '6.8' } } );
		update( {
			initialValues: {
				name: 'Blueprint name',
				phpVersion: '8.3',
				wpVersion: '6.7',
				adminUsername: 'blueprint-admin',
			},
		} );
		expect( siteName() ).toHaveValue( 'My manual name' );
		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( '6.8' );
		expect( screen.getByRole( 'combobox', { name: 'PHP version' } ) ).toHaveTextContent( '8.3' );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'blueprint-admin' );
	} );

	it( 'starts from the fields edited in an earlier opening, over suggestions', async () => {
		const onDraftChange = vi.fn();
		const { unmount } = await renderForm( { initialValues: { name: 'Proposed' }, onDraftChange } );
		fireEvent.change( siteName(), { target: { value: 'My draft ' } } );
		unmount();
		await renderForm( {
			initialValues: { name: 'Proposed', adminUsername: 'blueprint-admin' },
			draft: onDraftChange.mock.lastCall?.[ 0 ],
			onDraftChange,
		} );
		expect( siteName() ).toHaveValue( 'My draft ' );
		advanced();
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'blueprint-admin' );
		expect( onDraftChange ).toHaveBeenLastCalledWith( { name: 'My draft ' } );
	} );

	it( 'replaces earlier suggestions and restores defaults, keeping edits', async () => {
		const { update } = await renderForm( { initialValues: { name: 'Suggested site' } } );
		advanced();
		const defaultPassword = ( screen.getByLabelText( /Admin password/ ) as HTMLInputElement ).value;
		update( {
			initialValues: {
				name: 'First Blueprint',
				path: '/sites/first-blueprint',
				phpVersion: '8.2',
				wpVersion: '6.7',
				customDomain: 'first.local',
				enableHttps: true,
				adminUsername: 'first-admin',
				adminPassword: 'first-password',
				adminEmail: 'first@example.com',
			},
		} );
		fireEvent.change( screen.getByLabelText( /Admin username/ ), {
			target: { value: 'manual-admin' },
		} );
		update( { initialValues: { name: 'Second Blueprint', adminEmail: 'second@example.com' } } );

		expect( siteName() ).toHaveValue( 'Second Blueprint' );
		await waitFor( () => expect( localPath() ).toHaveValue( '/sites/Second Blueprint' ) );
		expect( screen.getByRole( 'combobox', { name: 'PHP version' } ) ).toHaveTextContent(
			RecommendedPHPVersion
		);
		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( DEFAULT_WORDPRESS_VERSION );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'manual-admin' );
		expect( screen.getByLabelText( /Admin password/ ) ).toHaveValue( defaultPassword );
		expect( screen.getByLabelText( /Admin email/ ) ).toHaveValue( 'second@example.com' );
		expect( screen.getByRole( 'switch', { name: 'Use custom domain' } ) ).not.toBeChecked();

		update( { initialValues: { name: 'Suggested site' } } );
		expect( siteName() ).toHaveValue( 'Suggested site' );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'manual-admin' );
		expect( screen.getByLabelText( /Admin email/ ) ).toHaveValue( 'admin@localhost.com' );
	} );

	it( 'shows validation errors from suggestions', async () => {
		const { update } = await renderForm( { initialValues: { name: 'Blueprint site' } } );
		update( { initialValues: { name: 'Blueprint site', customDomain: 'example.com' } } );
		advanced();
		expect( await screen.findByText( 'The domain name must end with .local' ) ).toBeVisible();
		const domain = screen.getByLabelText( 'Domain name' );
		expect( domain ).toBeInvalid();
		fireEvent.change( domain, { target: { value: 'example.local' } } );
		await waitFor( () => expect( domain ).toBeValid() );
	} );
} );

describe( 'CreateSiteForm path', () => {
	it( 'keeps validation pending, with submit available, while a suggested name resolves', async () => {
		const pending = deferred< ProposedPath >();
		const connector = createFakeConnector();
		connector.generateProposedSitePath.mockReturnValue( pending.promise );
		const { update } = await renderForm( {}, connector );
		update( { initialValues: { name: 'Suggested site' } } );
		expect( screen.queryByText( '1 error found' ) ).not.toBeInTheDocument();
		expect( submitButton() ).toBeEnabled();
		await pending.resolve( { path: '/sites/suggested', isEmpty: true, isWordPress: false } );
		await waitFor( () => expect( submitButton() ).toBeEnabled() );
	} );

	it( 'ignores a generated path once the site name has changed', async () => {
		const first = deferred< ProposedPath >();
		const second = deferred< ProposedPath >();
		const connector = createFakeConnector();
		connector.generateProposedSitePath
			.mockReturnValueOnce( first.promise )
			.mockReturnValueOnce( second.promise );
		await renderForm( { initialValues: { name: 'First' } }, connector );
		await waitFor( () =>
			expect( connector.generateProposedSitePath ).toHaveBeenCalledWith( 'First' )
		);
		fireEvent.change( siteName(), { target: { value: 'Second' } } );
		await waitFor( () =>
			expect( connector.generateProposedSitePath ).toHaveBeenCalledWith( 'Second' )
		);
		await second.resolve( { path: '/sites/second', isEmpty: true, isWordPress: false } );
		advanced();
		expect( localPath() ).toHaveValue( '/sites/second' );
		await first.resolve( { path: '/sites/first', isEmpty: true, isWordPress: false } );
		expect( localPath() ).toHaveValue( '/sites/second' );
	} );

	it( 'does not regenerate the path while it submits', async () => {
		const { connector, update } = await renderForm( { initialValues: { name: 'Created site' } } );
		advanced();
		await waitFor( () => expect( localPath() ).toHaveValue( '/sites/Created site' ) );
		connector.generateProposedSitePath.mockClear();
		update( { isSubmitting: true, initialValues: { name: 'Created site' } } );
		expect( connector.generateProposedSitePath ).not.toHaveBeenCalled();
		expect( localPath() ).toHaveValue( '/sites/Created site' );
	} );

	it( 'queues a submit until the path resolves', async () => {
		const pending = deferred< ProposedPath >();
		const connector = createFakeConnector();
		connector.generateProposedSitePath.mockReturnValue( pending.promise );
		const { onSubmit } = await renderForm( {}, connector );
		fireEvent.change( siteName(), { target: { value: 'My site' } } );
		expect( submitButton() ).toBeEnabled();
		fireEvent.click( submitButton() );
		expect( onSubmit ).not.toHaveBeenCalled();
		await pending.resolve( { path: '/sites/my-site', isEmpty: true, isWordPress: false } );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith(
				expect.objectContaining( { path: '/sites/my-site' } )
			)
		);
	} );

	it( 'keeps a typed path over a generated one still pending', async () => {
		const pending = deferred< ProposedPath >();
		const { connector, onSubmit } = await renderForm( { initialValues: { name: 'Pending' } } );
		connector.generateProposedSitePath.mockReturnValue( pending.promise );
		connector.selectSiteFolder.mockResolvedValue( {
			name: 'manual',
			path: '/sites/manual',
			isEmpty: true,
			isWordPress: false,
		} );
		advanced();
		fireEvent.change( localPath(), { target: { value: '/sites/manual' } } );
		await pending.resolve( { path: '/sites/generated', isEmpty: true, isWordPress: false } );
		expect( localPath() ).toHaveValue( '/sites/manual' );
		await waitFor( () => expect( submitButton() ).toBeEnabled() );
		fireEvent.click( submitButton() );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith(
				expect.objectContaining( { path: '/sites/manual' } )
			)
		);
	} );

	it( 'checks a typed folder, and adds an existing WordPress site as it is', async () => {
		const onExistingChange = vi.fn();
		const { connector } = await renderForm( {
			initialValues: { name: 'Typed' },
			onExistingChange,
		} );
		connector.selectSiteFolder.mockImplementation( async ( path ) => ( {
			name: 'Typed',
			path: path ?? '',
			isEmpty: false,
			isWordPress: path === '/sites/wordpress',
		} ) );
		advanced();
		fireEvent.change( localPath(), { target: { value: '/sites/full' } } );
		await waitFor( () =>
			expect( localPath() ).toHaveAccessibleDescription(
				'Choose an empty folder or an existing WordPress site.'
			)
		);
		fireEvent.change( localPath(), { target: { value: '/sites/wordpress' } } );
		expect( await screen.findByText( 'Existing local WordPress site' ) ).toBeVisible();
		expect( screen.queryByLabelText( /Admin username/ ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'switch', { name: 'Use custom domain' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'WordPress version' ) ).not.toBeInTheDocument();
		expect( onExistingChange ).toHaveBeenLastCalledWith( true );
	} );

	it( 'refuses an existing WordPress site when the folder must start empty', async () => {
		const connector = createFakeConnector();
		connector.generateProposedSitePath.mockResolvedValue( {
			path: '/sites/occupied',
			isEmpty: false,
			isWordPress: true,
		} );
		await renderForm( { initialValues: { name: 'Occupied' }, requiresEmptyPath: true }, connector );
		await waitFor( () =>
			expect( localPath() ).toHaveAccessibleDescription( /Choose an empty folder/ )
		);
		expect( screen.queryByText( 'Existing local WordPress site' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Create site' } ) ).toBeDisabled();
	} );

	it( 'shows folder errors without opening Advanced settings, keeping focus on the name', async () => {
		const connector = createFakeConnector();
		connector.generateProposedSitePath.mockResolvedValue( {
			path: '/sites/full',
			isEmpty: false,
			isWordPress: false,
		} );
		await renderForm( { initialValues: { name: 'Full' } }, connector );
		expect( siteName() ).toHaveFocus();
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: /Advanced settings/ } ) ).toHaveAttribute(
				'aria-expanded',
				'false'
			)
		);
		await waitFor( () =>
			expect( localPath() ).toHaveAccessibleDescription(
				'Choose an empty folder or an existing WordPress site.'
			)
		);
		expect( localPath() ).toBeVisible();
		expect( submitButton() ).toBeDisabled();
	} );

	it( 'says when no folder can be suggested for the name', async () => {
		const connector = createFakeConnector();
		connector.generateProposedSitePath.mockRejectedValue( new Error( 'offline' ) );
		await renderForm( { initialValues: { name: 'Unavailable' } }, connector );
		advanced();
		expect(
			await screen.findByText( 'Unable to suggest a folder for this site name.' )
		).toBeVisible();
		expect( submitButton() ).toBeDisabled();
	} );

	it( 'marks the focused folder picker invalid as soon as a picked folder fails', async () => {
		const connector = createFakeConnector();
		connector.selectSiteFolder.mockResolvedValue( {
			name: 'taken',
			path: '/sites/taken',
			isEmpty: false,
			isWordPress: false,
		} );
		await renderForm( { initialValues: { name: 'Site' } }, connector );
		advanced();
		await waitFor( () => expect( localPath() ).toHaveValue( '/sites/Site' ) );
		const picker = screen.getByRole( 'button', {
			name: /select a different folder|Select a folder/,
		} );
		picker.focus();
		fireEvent.click( picker );
		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			'Choose an empty folder or an existing WordPress site.'
		);
		expect( picker ).toHaveFocus();
		expect( localPath() ).toBeInvalid();
	} );
} );

describe( 'CreateSiteForm fields', () => {
	it( 'offers file access choices without a PHP runtime choice', async () => {
		const { onSubmit } = await renderForm( { initialValues: { name: 'Runtime' } } );
		advanced();
		expect( screen.queryByRole( 'combobox', { name: /runtime/i } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'combobox', { name: 'File access' } ) ).toHaveTextContent(
			'Site directory'
		);
		await chooseOption( 'File access', /^All files/ );
		await waitFor( () => expect( submitButton() ).toBeEnabled() );
		fireEvent.click( submitButton() );
		expect( onSubmit ).toHaveBeenCalledWith(
			expect.objectContaining( { fileAccess: 'all-files' } )
		);
		expect( onSubmit.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'runtime' );
	} );

	it.each( [
		[ '4.9', 'Auto-update (6.8)', versions( [ '6.8', 'latest' ], [ '6.8', '6.8' ] ) ],
		[
			'6.5',
			'6.5.13',
			versions( [ '6.8', 'latest' ], [ '6.8.1', '6.8.1' ], [ '6.5.13', '6.5.13' ] ),
		],
	] )( 'maps a suggested WordPress %s to %s', async ( wpVersion, shown, available ) => {
		const connector = createFakeConnector();
		connector.getWordPressVersions.mockResolvedValue( available );
		await renderForm( { initialValues: { name: 'Old Blueprint', wpVersion } }, connector );
		advanced();
		await waitFor( () =>
			expect( screen.getByRole( 'combobox', { name: 'WordPress version' } ) ).toHaveTextContent(
				shown
			)
		);
	} );

	it( "says when a suggested WordPress version can't be installed", async () => {
		const connector = createFakeConnector();
		connector.getWordPressVersions.mockResolvedValue(
			versions( [ '6.8', 'latest' ], [ '6.8.1', '6.8.1' ] )
		);
		await renderForm( { initialValues: { name: 'Old Blueprint', wpVersion: '5.9' } }, connector );
		advanced();
		expect(
			await screen.findByText(
				"This Blueprint asks for WordPress 5.9, which WordPress Studio can't install."
			)
		).toBeVisible();
		expect( screen.getByRole( 'combobox', { name: 'WordPress version' } ) ).toHaveTextContent(
			'Auto-update (6.8)'
		);
	} );

	it( 'names the version a new site will be created with, and submits a beta', async () => {
		const connector = createFakeConnector();
		connector.getWordPressVersions.mockResolvedValue(
			versions( [ '6.9', 'latest' ], [ '7.0-beta1', '7.0-beta1' ], [ '6.9', '6.9' ] )
		);
		const { onSubmit } = await renderForm( { initialValues: { name: 'New site' } }, connector );
		advanced();
		await waitFor( () =>
			expect( screen.getByRole( 'combobox', { name: 'WordPress version' } ) ).toHaveTextContent(
				'Auto-update (6.9)'
			)
		);
		await chooseOption( 'WordPress version', '7.0-beta1' );
		fireEvent.click( screen.getByRole( 'combobox', { name: 'WordPress version' } ) );
		expect(
			await screen.findByRole( 'option', { name: /Auto-update \(6\.9\)/ } )
		).toHaveTextContent( /^Auto-update \(6\.9\)$/ );
		expect( screen.getByRole( 'group', { name: 'Beta & Nightly' } ) ).toBeInTheDocument();
		fireEvent.keyDown( screen.getByRole( 'listbox' ), { key: 'Escape' } );
		await waitFor( () => expect( submitButton() ).toBeEnabled() );
		fireEvent.click( submitButton() );
		expect( onSubmit ).toHaveBeenCalledWith(
			expect.objectContaining( { wpVersion: '7.0-beta1' } )
		);
	} );

	it( 'locks the WordPress version to Auto-update while offline', async () => {
		vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		await renderForm( { initialValues: { name: 'Offline site', wpVersion: '6.7' } } );
		advanced();
		const select = screen.getByRole( 'combobox', { name: 'WordPress version' } );
		expect( select ).toBeDisabled();
		await waitFor( () => expect( select ).toHaveTextContent( 'Auto-update' ) );
	} );

	it( 'requires a site name once it has been edited', async () => {
		await renderForm( { initialValues: { name: 'Named site' } } );
		expect( screen.queryByText( 'Site name is required.' ) ).not.toBeInTheDocument();
		fireEvent.change( siteName(), { target: { value: ' ' } } );
		expect( siteName() ).toHaveAccessibleDescription( 'Site name is required.' );
		expect( submitButton() ).toBeDisabled();
	} );

	it( 'counts errors in the collapsed advanced settings', async () => {
		await renderForm( { initialValues: { name: 'Site', adminEmail: 'not-an-email' } } );
		expect( screen.getByText( '1 error found' ) ).toBeVisible();
		expect( submitButton() ).toBeDisabled();
		advanced();
		expect( screen.getByLabelText( /Admin email/ ) ).toHaveAccessibleDescription(
			'Please enter a valid email address.'
		);
	} );

	it( 'honors an external submission gate', async () => {
		await renderForm( { initialValues: { name: 'Blocked site' }, isSubmitDisabled: true } );
		await waitFor( () => expect( submitButton() ).toBeDisabled() );
	} );

	it( 'shows an actionable submission error with optional technical details', async () => {
		const { onCancel } = await renderForm( {
			initialValues: { name: 'Imported site', path: '/sites/imported-site' },
			submitLabel: 'Retry import',
			cancelLabel: 'Choose another backup',
			submitError: {
				title: 'WordPress Studio could not import this backup.',
				message: 'The incomplete site was removed.',
				details: 'CLI command failed',
			},
		} );
		const alert = screen.getByRole( 'alert' );
		expect( alert ).toHaveTextContent( 'WordPress Studio could not import this backup.' );
		expect( alert ).toHaveTextContent( 'The incomplete site was removed.' );
		expect( screen.getByRole( 'button', { name: 'Retry import' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Choose another backup' } ) );
		expect( onCancel ).toHaveBeenCalledOnce();
		fireEvent.click( screen.getByText( 'View technical details' ) );
		expect( screen.getByText( 'CLI command failed' ) ).toBeVisible();
	} );
} );
