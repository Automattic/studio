import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, type FakeConnector } from '@/test/fake-connector';
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
		{ capabilities: { nativeFolderPicker: true, annotatePreview: false, studioLogs: false } }
	)
) {
	const onSubmit = vi.fn();
	let setProps!: ( props: Partial< Props > ) => void;
	function Harness() {
		const [ props, set ] = useState( initialProps );
		setProps = ( next ) => set( ( previous ) => ( { ...previous, ...next } ) );
		return <CreateSiteForm existingDomainNames={ [] } onSubmit={ onSubmit } { ...props } />;
	}
	const view = renderWithProviders( <Harness />, { connector } );
	await screen.findByRole( 'textbox', { name: /Site name/ } );
	return {
		...view,
		connector,
		onSubmit,
		update: ( props: Partial< Props > ) => act( () => setProps( props ) ),
	};
}

const siteName = () => screen.getByRole( 'textbox', { name: /Site name/ } );
const localPath = () => screen.getByLabelText( 'Site folder' );
const submitButton = () => screen.getByTestId( 'create-site-submit' );
const advanced = () => {
	const control = screen.getByRole( 'button', { name: 'Advanced' } );
	if ( control.getAttribute( 'aria-expanded' ) !== 'true' ) fireEvent.click( control );
};
const editSettings = ( name: string ) =>
	fireEvent.click( screen.getByRole( 'button', { name: `Edit ${ name }` } ) );
const done = () =>
	fireEvent.click(
		screen.getByRole( 'button', { name: /^Edit (Admin account|Domain)$/, expanded: true } )
	);

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
		editSettings( 'Admin account' );
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
		editSettings( 'Admin account' );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'blueprint-admin' );
		expect( onDraftChange ).toHaveBeenLastCalledWith( { name: 'My draft ' } );
	} );

	it( 'replaces earlier suggestions and restores defaults, keeping edits', async () => {
		const { update } = await renderForm( { initialValues: { name: 'Suggested site' } } );
		advanced();
		editSettings( 'Admin account' );
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
		await waitFor( () =>
			expect( localPath() ).toHaveAttribute( 'title', '/sites/Second Blueprint' )
		);
		expect( screen.getByRole( 'combobox', { name: 'PHP version' } ) ).toHaveTextContent(
			RecommendedPHPVersion
		);
		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( DEFAULT_WORDPRESS_VERSION );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'manual-admin' );
		expect( screen.getByLabelText( /Admin password/ ) ).toHaveValue( defaultPassword );
		expect( screen.getByLabelText( /Admin email/ ) ).toHaveValue( 'second@example.com' );
		done();
		editSettings( 'Domain' );
		expect( screen.getByRole( 'switch', { name: 'Use custom domain' } ) ).not.toBeChecked();
		done();
		editSettings( 'Admin account' );

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
		editSettings( 'Domain' );
		const domain = screen.getByLabelText( 'Domain name' );
		expect( domain ).toBeInvalid();
		fireEvent.change( domain, { target: { value: 'example.local' } } );
		await waitFor( () => expect( domain ).toBeValid() );
	} );
} );

describe( 'CreateSiteForm path', () => {
	it.each( [ '/projects/custom', 'C:\\Users\\Rich\\Studio\\custom' ] )(
		'restores automatic folder naming while preserving the parent: %s',
		async ( path ) => {
			const { user, connector, onSubmit } = await renderForm( {
				initialValues: { name: 'Café & Bakery!', path },
			} );
			const parent = path.slice( 0, -'custom'.length );
			connector.selectSiteFolder.mockImplementation( async ( selectedPath ) => ( {
				path: selectedPath,
				name: 'folder',
				isEmpty: true,
				isWordPress: false,
			} ) );
			const reset = () =>
				screen.queryByRole( 'button', { name: 'Reset folder name to match site name' } );
			expect( reset() ).toBeVisible();
			await user.click( reset()! );
			expect( localPath() ).toHaveValue( 'cafe-bakery' );
			expect( localPath() ).toHaveAttribute( 'title', parent + 'cafe-bakery' );
			expect( localPath() ).toHaveFocus();
			expect( reset() ).not.toBeInTheDocument();
			fireEvent.change( siteName(), { target: { value: 'New title' } } );
			expect( localPath() ).toHaveValue( 'new-title' );
			expect( reset() ).not.toBeInTheDocument();
			fireEvent.change( siteName(), { target: { value: '' } } );
			expect( localPath() ).toHaveValue( '' );
			expect( localPath() ).toHaveAttribute( 'title', parent );
			fireEvent.change( siteName(), { target: { value: 'New title' } } );
			expect( localPath() ).toHaveValue( 'new-title' );
			fireEvent.change( localPath(), { target: { value: 'independent' } } );
			fireEvent.change( siteName(), { target: { value: 'Another title' } } );
			expect( localPath() ).toHaveValue( 'independent' );
			await user.click( reset()! );
			expect( localPath() ).toHaveValue( 'another-title' );
			fireEvent.click( submitButton() );
			await waitFor( () =>
				expect( onSubmit ).toHaveBeenCalledWith(
					expect.objectContaining( { name: 'Another title', path: parent + 'another-title' } )
				)
			);
			expect( connector.selectSiteFolder ).toHaveBeenCalledWith( parent + 'another-title', {
				usePath: true,
			} );
		}
	);

	it( 'keeps restored automatic naming when reopening the draft', async () => {
		const onDraftChange = vi.fn();
		const { user, unmount } = await renderForm( {
			initialValues: { name: 'Bakery', path: '/projects/custom' },
			onDraftChange,
		} );
		await user.click(
			screen.getByRole( 'button', { name: 'Reset folder name to match site name' } )
		);
		const draft = onDraftChange.mock.lastCall?.[ 0 ];
		unmount();
		await renderForm( { initialValues: { name: 'Bakery' }, draft } );
		fireEvent.change( siteName(), { target: { value: 'New Bakery' } } );
		expect( localPath() ).toHaveValue( 'new-bakery' );
		expect( localPath() ).toHaveAttribute( 'title', '/projects/new-bakery' );
	} );

	it( 'matches a new suggested title when restoring an automatically named draft', async () => {
		await renderForm( {
			initialValues: { name: 'New Blueprint' },
			draft: { path: '/projects/old-blueprint', matchSiteName: true },
		} );
		expect( localPath() ).toHaveValue( 'new-blueprint' );
		expect( localPath() ).toHaveAttribute( 'title', '/projects/new-blueprint' );
		fireEvent.change( siteName(), { target: { value: 'Updated title' } } );
		expect( localPath() ).toHaveValue( 'updated-title' );
	} );

	it( 'does not offer a reset for an empty site name or an existing WordPress location', async () => {
		const { update } = await renderForm( { initialValues: { name: '', path: '/sites/custom' } } );
		const reset = () =>
			screen.queryByRole( 'button', { name: 'Reset folder name to match site name' } );
		expect( reset() ).not.toBeInTheDocument();
		fireEvent.change( siteName(), { target: { value: 'Custom title' } } );
		expect( reset() ).toBeVisible();
		update( { requiresExistingPath: true } );
		expect( localPath() ).toHaveAttribute( 'readonly' );
		expect( reset() ).not.toBeInTheDocument();
	} );

	it( 'validates the reset destination before allowing source files to be imported', async () => {
		const { user, connector, onSubmit } = await renderForm( {
			initialValues: { name: 'Existing', path: '/sites/custom' },
			requiresEmptyPath: true,
		} );
		connector.selectSiteFolder.mockImplementation( async ( path ) => ( {
			path,
			name: 'folder',
			isEmpty: path !== '/sites/existing',
			isWordPress: path === '/sites/existing',
		} ) );
		await user.click(
			screen.getByRole( 'button', { name: 'Reset folder name to match site name' } )
		);
		fireEvent.click( submitButton() );
		await screen.findByText(
			'Choose an empty folder to use a source. The selected folder already contains a WordPress site.'
		);
		expect( submitButton() ).toBeDisabled();
		expect( onSubmit ).not.toHaveBeenCalled();
		fireEvent.change( siteName(), { target: { value: 'Fresh' } } );
		expect( localPath() ).toHaveValue( 'fresh' );
		fireEvent.click( submitButton() );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith( expect.objectContaining( { path: '/sites/fresh' } ) )
		);
	} );

	it( 'keeps Change visible and disabled when the host has no folder picker', async () => {
		const connector = createFakeConnector(
			{},
			{ capabilities: { nativeFolderPicker: false, annotatePreview: false, studioLogs: false } }
		);
		const { user } = await renderForm( { initialValues: { name: 'Bakery' } }, connector );
		const change = screen.getByRole( 'button', { name: 'Change…' } );
		expect( change ).toBeVisible();
		expect( change ).toBeDisabled();
		await user.click( change );
		expect( connector.selectSiteFolder ).not.toHaveBeenCalled();
	} );

	it( 'keeps the parent fixed and lets the folder name diverge from the site name', async () => {
		const { user, onSubmit } = await renderForm();
		const parent = await screen.findByRole( 'group', { name: 'Parent folder' } );
		await waitFor( () => expect( parent ).toHaveTextContent( '/sites/' ) );
		expect( parent ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( parent.querySelector( 'input, textarea' ) ).toBeNull();
		expect( localPath() ).toHaveValue( '' );
		fireEvent.change( siteName(), { target: { value: 'Bakery' } } );
		await waitFor( () => expect( localPath() ).toHaveValue( 'Bakery' ) );
		expect( localPath() ).not.toHaveAttribute( 'readonly' );
		await user.clear( localPath() );
		await user.type( localPath(), 'independent-folder' );
		fireEvent.change( siteName(), { target: { value: 'Different title' } } );
		expect( localPath() ).toHaveValue( 'independent-folder' );
		expect( parent ).toHaveTextContent( '/sites/' );
		expect( localPath() ).toHaveAttribute( 'title', '/sites/independent-folder' );
		fireEvent.click( submitButton() );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith(
				expect.objectContaining( { name: 'Different title', path: '/sites/independent-folder' } )
			)
		);
	} );

	it.each( [ '../outside', 'other/folder', 'other\\folder' ] )(
		'prevents editing the parent through %s',
		async ( name ) => {
			await renderForm( { initialValues: { name: 'Bakery' } } );
			await waitFor( () => expect( localPath() ).toHaveValue( 'Bakery' ) );
			fireEvent.change( localPath(), { target: { value: name } } );
			expect( localPath() ).toHaveValue( 'Bakery' );
			expect( localPath() ).toHaveAttribute( 'title', '/sites/Bakery' );
		}
	);

	it.each( [ '.', '..' ] )( 'refuses the folder name "%s"', async ( name ) => {
		const { onSubmit } = await renderForm( { initialValues: { name: 'Bakery' } } );
		await waitFor( () => expect( localPath() ).toHaveValue( 'Bakery' ) );
		fireEvent.change( localPath(), { target: { value: name } } );
		expect( submitButton() ).toBeDisabled();
		fireEvent.submit( submitButton().closest( 'form' )! );
		expect( onSubmit ).not.toHaveBeenCalled();
	} );

	it.each( [ '/projects/custom', 'C:\\Users\\Rich\\Studio\\custom' ] )(
		'restores the title-derived name after clearing the slug in %s',
		async ( path ) => {
			const { user } = await renderForm( { initialValues: { name: 'Café & Bakery!', path } } );
			await user.clear( localPath() );
			expect( localPath() ).toHaveValue( '' );
			expect( localPath() ).not.toBeInvalid();
			expect( screen.queryByText( 'Site folder is required.' ) ).not.toBeInTheDocument();
			await user.tab();
			expect( localPath() ).toHaveValue( 'cafe-bakery' );
			expect( localPath() ).toHaveAttribute(
				'title',
				path.slice( 0, -'custom'.length ) + 'cafe-bakery'
			);
			fireEvent.change( siteName(), { target: { value: 'New Bakery' } } );
			expect( localPath() ).toHaveValue( 'new-bakery' );
			await user.clear( localPath() );
			await user.type( localPath(), 'independent' );
			fireEvent.change( siteName(), { target: { value: 'Another Bakery' } } );
			expect( localPath() ).toHaveValue( 'independent' );
		}
	);

	it( 'submits the title-derived destination when the slug is cleared without blurring', async () => {
		const { user, onSubmit } = await renderForm( {
			initialValues: { name: 'Café & Bakery!', path: '/projects/custom' },
		} );
		await user.clear( localPath() );
		fireEvent.submit( submitButton().closest( 'form' )! );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith(
				expect.objectContaining( { path: '/projects/cafe-bakery' } )
			)
		);
	} );

	it( 'does not add a folder-required error when both the title and slug are empty', async () => {
		const { user, onSubmit } = await renderForm( {
			initialValues: { name: 'Bakery', path: '/projects/custom' },
		} );
		await user.clear( siteName() );
		await user.clear( localPath() );
		await user.tab();
		expect( localPath() ).toHaveValue( '' );
		expect( localPath() ).not.toBeInvalid();
		expect( screen.queryByText( 'Site folder is required.' ) ).not.toBeInTheDocument();
		fireEvent.submit( submitButton().closest( 'form' )! );
		expect( onSubmit ).not.toHaveBeenCalled();
		fireEvent.change( siteName(), { target: { value: 'New Bakery' } } );
		expect( localPath() ).toHaveValue( 'new-bakery' );
	} );

	it( 'validates typed destination names against existing WordPress sites', async () => {
		const { connector, onSubmit } = await renderForm( {
			initialValues: { name: 'Import' },
			requiresEmptyPath: true,
		} );
		connector.selectSiteFolder.mockImplementation( async ( path ) => ( {
			path,
			name: 'folder',
			isEmpty: path !== '/sites/existing',
			isWordPress: path === '/sites/existing',
		} ) );
		fireEvent.change( localPath(), { target: { value: 'existing' } } );
		await screen.findByText(
			'Choose an empty folder to use a source. The selected folder already contains a WordPress site.'
		);
		expect( submitButton() ).toBeDisabled();
		fireEvent.change( localPath(), { target: { value: 'fresh' } } );
		fireEvent.click( submitButton() );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith( expect.objectContaining( { path: '/sites/fresh' } ) )
		);
	} );

	it.each( [ '/projects/chosen', 'C:\\Users\\Rich\\Studio\\chosen', '\\\\server\\share\\chosen' ] )(
		'preserves the chosen full path when the title changes: %s',
		async ( path ) => {
			const { connector } = await renderForm( { initialValues: { name: 'Bakery' } } );
			connector.selectSiteFolder.mockResolvedValue( {
				name: 'chosen',
				path,
				isEmpty: true,
				isWordPress: false,
			} );
			fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
			await waitFor( () => expect( localPath() ).toHaveAttribute( 'title', path ) );
			fireEvent.change( siteName(), { target: { value: 'Unrelated title' } } );
			expect( localPath() ).toHaveAttribute( 'title', path );
			expect( localPath() ).not.toHaveAttribute( 'readonly' );
		}
	);

	it( 'rejects an existing WordPress destination for an imported source and accepts an empty replacement', async () => {
		const { connector, onSubmit } = await renderForm( {
			initialValues: { name: 'Import' },
			requiresEmptyPath: true,
		} );
		connector.selectSiteFolder.mockResolvedValue( {
			name: 'existing',
			path: '/sites/existing',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await screen.findByText(
			'Choose an empty folder to use a source. The selected folder already contains a WordPress site.'
		);
		expect( submitButton() ).toBeDisabled();
		fireEvent.submit( submitButton().closest( 'form' )! );
		expect( onSubmit ).not.toHaveBeenCalled();
		connector.selectSiteFolder.mockResolvedValue( {
			name: 'empty',
			path: '/sites/empty',
			isEmpty: true,
			isWordPress: false,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await waitFor( () => expect( submitButton() ).toBeEnabled() );
		fireEvent.click( submitButton() );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith( expect.objectContaining( { path: '/sites/empty' } ) )
		);
	} );

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
		expect( localPath() ).toHaveAttribute( 'title', '/sites/second' );
		await first.resolve( { path: '/sites/first', isEmpty: true, isWordPress: false } );
		expect( localPath() ).toHaveAttribute( 'title', '/sites/second' );
	} );

	it( 'does not regenerate the path while it submits', async () => {
		const { connector, update } = await renderForm( { initialValues: { name: 'Created site' } } );
		advanced();
		await waitFor( () => expect( localPath() ).toHaveAttribute( 'title', '/sites/Created site' ) );
		connector.generateProposedSitePath.mockClear();
		update( { isSubmitting: true, initialValues: { name: 'Created site' } } );
		expect( connector.generateProposedSitePath ).not.toHaveBeenCalled();
		expect( localPath() ).toHaveAttribute( 'title', '/sites/Created site' );
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

	it( 'keeps a chosen folder over a generated one still pending', async () => {
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
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await pending.resolve( { path: '/sites/generated', isEmpty: true, isWordPress: false } );
		expect( localPath() ).toHaveAttribute( 'title', '/sites/manual' );
		await waitFor( () => expect( submitButton() ).toBeEnabled() );
		fireEvent.click( submitButton() );
		await waitFor( () =>
			expect( onSubmit ).toHaveBeenCalledWith(
				expect.objectContaining( { path: '/sites/manual' } )
			)
		);
	} );

	it( 'checks a chosen folder, and adds an existing WordPress site as it is', async () => {
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
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Full',
			path: '/sites/full',
			isEmpty: false,
			isWordPress: false,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await waitFor( () =>
			expect( localPath() ).toHaveAccessibleDescription(
				/Choose an empty folder or an existing WordPress site./
			)
		);
		connector.selectSiteFolder.mockResolvedValue( {
			name: 'WordPress',
			path: '/sites/wordpress',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		expect(
			await screen.findByText(
				'Studio will use this WordPress site in place. No files will be moved.'
			)
		).toBeVisible();
		advanced();
		expect( screen.queryByLabelText( /Admin username/ ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'switch', { name: 'Use custom domain' } ) ).not.toBeInTheDocument();
		await waitFor( () =>
			expect( screen.queryByText( 'WordPress version' ) ).not.toBeInTheDocument()
		);
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
			expect( localPath() ).toHaveAccessibleDescription( /Choose an empty folder to use a source/ )
		);
		expect(
			screen.queryByText( 'Studio will use this WordPress site in place. No files will be moved.' )
		).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
	} );

	it( 'shows folder errors beside the path without opening Advanced or moving focus', async () => {
		const connector = createFakeConnector();
		connector.generateProposedSitePath.mockResolvedValue( {
			path: '/sites/full',
			isEmpty: false,
			isWordPress: false,
		} );
		await renderForm( { initialValues: { name: 'Full' } }, connector );
		expect( siteName() ).toHaveFocus();
		await waitFor( () =>
			expect( localPath() ).toHaveAccessibleDescription(
				/Choose an empty folder or an existing WordPress site./
			)
		);
		expect( localPath() ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Advanced' } ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		expect( siteName() ).toHaveFocus();
		expect( submitButton() ).toBeDisabled();
	} );

	it( 'says when no folder can be suggested for the name', async () => {
		const connector = createFakeConnector();
		connector.generateProposedSitePath.mockRejectedValue( new Error( 'offline' ) );
		await renderForm( { initialValues: { name: 'Unavailable' } }, connector );
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
		await waitFor( () => expect( localPath() ).toHaveAttribute( 'title', '/sites/Site' ) );
		const picker = screen.getByRole( 'button', {
			name: 'Change…',
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
	it( 'opens and closes advanced settings in a popover, preserving edits', async () => {
		await renderForm( { initialValues: { name: 'Bakery' } } );
		const control = screen.getByRole( 'button', { name: 'Advanced' } );
		expect( control ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( screen.queryByRole( 'combobox', { name: 'PHP version' } ) ).not.toBeInTheDocument();
		fireEvent.click( control );
		await chooseOption( 'PHP version', '8.2' );
		fireEvent.click( control );
		expect( control ).toHaveAttribute( 'aria-expanded', 'false' );
		await waitFor( () =>
			expect( screen.queryByRole( 'combobox', { name: 'PHP version' } ) ).not.toBeInTheDocument()
		);
		fireEvent.click( control );
		expect( screen.getByRole( 'combobox', { name: 'PHP version' } ) ).toHaveTextContent( '8.2' );
	} );

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

	it( 'clears name errors on focus and revalidates on blur while preventing an empty submission', async () => {
		const { onSubmit } = await renderForm( { initialValues: { name: 'Named site' } } );
		expect( screen.queryByText( 'Site name is required.' ) ).not.toBeInTheDocument();
		fireEvent.change( siteName(), { target: { value: ' ' } } );
		expect( screen.queryByText( 'Site name is required.' ) ).not.toBeInTheDocument();
		fireEvent.blur( siteName() );
		expect( siteName() ).toHaveAccessibleDescription( 'Site name is required.' );
		expect( submitButton() ).toBeDisabled();
		fireEvent.focus( siteName() );
		expect( screen.queryByText( 'Site name is required.' ) ).not.toBeInTheDocument();
		expect( siteName() ).not.toHaveAttribute( 'aria-invalid', 'true' );
		expect( submitButton() ).toBeDisabled();
		fireEvent.submit( siteName().closest( 'form' )! );
		expect( onSubmit ).not.toHaveBeenCalled();
		fireEvent.blur( siteName() );
		expect( siteName() ).toHaveAccessibleDescription( 'Site name is required.' );
		fireEvent.focus( siteName() );
		fireEvent.change( siteName(), { target: { value: 'Valid site' } } );
		fireEvent.blur( siteName() );
		expect( screen.queryByText( 'Site name is required.' ) ).not.toBeInTheDocument();
		await waitFor( () => expect( submitButton() ).toBeEnabled() );
	} );

	it( 'opens advanced settings to reveal invalid Blueprint defaults', async () => {
		await renderForm( { initialValues: { name: 'Site', adminEmail: 'not-an-email' } } );
		const control = screen.getByRole( 'button', { name: 'Advanced' } );
		expect( control ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( submitButton() ).toBeDisabled();
		fireEvent.click( control );
		expect( control ).toHaveAttribute( 'aria-expanded', 'false' );
		expect(
			screen.getByText( 'Review the advanced settings to finish creating your site.' )
		).toBeVisible();
		fireEvent.click( control );
		expect(
			screen.getByRole( 'button', { name: 'Edit Admin account' } )
		).toHaveAccessibleDescription( 'Please enter a valid email address.' );
		editSettings( 'Admin account' );
		expect( screen.getByLabelText( /Admin email/ ) ).toHaveAccessibleDescription(
			'Please enter a valid email address.'
		);
		fireEvent.change( screen.getByLabelText( /Admin email/ ), {
			target: { value: 'owner@example.com' },
		} );
		done();
		await waitFor( () => expect( submitButton() ).toBeEnabled() );
	} );

	it( 'keeps account and domain edits when their sections close and submits them', async () => {
		const { onSubmit } = await renderForm( { initialValues: { name: 'Bakery' } } );
		advanced();
		expect( screen.queryByLabelText( /Admin username/ ) ).not.toBeInTheDocument();
		editSettings( 'Admin account' );
		fireEvent.change( screen.getByLabelText( /Admin username/ ), {
			target: { value: 'baker' },
		} );
		done();
		expect( screen.getByRole( 'button', { name: 'Edit Admin account' } ) ).toHaveTextContent(
			'baker'
		);
		editSettings( 'Admin account' );
		expect( screen.getByLabelText( /Admin username/ ) ).toHaveValue( 'baker' );
		done();
		editSettings( 'Domain' );
		fireEvent.click( screen.getByRole( 'switch', { name: 'Use custom domain' } ) );
		fireEvent.change( screen.getByLabelText( 'Domain name' ), {
			target: { value: 'bakery.local' },
		} );
		fireEvent.click( screen.getByRole( 'switch', { name: 'Enable HTTPS' } ) );
		done();
		expect( screen.getByRole( 'button', { name: 'Edit Domain' } ) ).toHaveTextContent(
			'bakery.local'
		);
		await waitFor( () => expect( submitButton() ).toBeEnabled() );
		fireEvent.click( submitButton() );
		expect( onSubmit ).toHaveBeenCalledWith(
			expect.objectContaining( {
				adminUsername: 'baker',
				customDomain: 'bakery.local',
				enableHttps: true,
			} )
		);
	} );

	it( 'honors an external submission gate', async () => {
		await renderForm( { initialValues: { name: 'Blocked site' }, isSubmitDisabled: true } );
		await waitFor( () => expect( submitButton() ).toBeDisabled() );
	} );

	it( 'shows an actionable submission error with optional technical details', async () => {
		await renderForm( {
			initialValues: { name: 'Imported site', path: '/sites/imported-site' },
			submitError: {
				title: 'WordPress Studio could not import this backup.',
				message: 'The incomplete site was removed.',
				details: 'CLI command failed',
			},
		} );
		const alert = screen.getByRole( 'alert' );
		expect( alert ).toHaveTextContent( 'WordPress Studio could not import this backup.' );
		expect( alert ).toHaveTextContent( 'The incomplete site was removed.' );
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Cancel' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByText( 'View technical details' ) );
		expect( screen.getByText( 'CLI command failed' ) ).toBeVisible();
	} );
} );
