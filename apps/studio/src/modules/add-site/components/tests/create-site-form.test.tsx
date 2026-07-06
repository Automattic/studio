import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import { CreateSiteForm } from '../create-site-form';
import type { CreateSiteFormValues } from 'src/hooks/use-add-site';

const mockGetDefaultDatabaseEngine = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getDefaultDatabaseEngine: mockGetDefaultDatabaseEngine,
	} ),
} ) );

vi.mock( 'src/stores/certificate-trust-api', async () => {
	const actual = await vi.importActual( 'src/stores/certificate-trust-api' );
	return {
		...( actual || {} ),
		useCheckCertificateTrustQuery: () => ( { data: false } ),
	};
} );

vi.mock( 'src/components/learn-more', () => ( {
	LearnHowLink: () => null,
	LearnMoreLink: () => null,
} ) );

vi.mock( 'src/components/wp-version-selector', () => ( {
	WPVersionSelector: ( {
		selectedValue,
		onChange,
	}: {
		selectedValue: string;
		onChange: ( value: string ) => void;
	} ) => (
		<select
			aria-label="WordPress version"
			value={ selectedValue }
			onChange={ ( event ) => onChange( event.target.value ) }
		>
			<option value="latest">Latest</option>
		</select>
	),
} ) );

function renderCreateSiteForm( onSubmit = vi.fn() ) {
	const result = render(
		<CreateSiteForm
			defaultValues={ { siteName: 'Test Site', sitePath: '/tmp/test-site' } }
			onSelectPath={ vi.fn() }
			onSiteNameChange={ vi.fn() }
			onSubmit={ onSubmit }
		/>
	);

	return { ...result, onSubmit };
}

describe( 'CreateSiteForm', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mockGetDefaultDatabaseEngine.mockResolvedValue( 'sqlite' );
	} );

	it( 'shows and submits the resolved default database engine', async () => {
		mockGetDefaultDatabaseEngine.mockResolvedValue( 'mysql' );
		const { container, onSubmit } = renderCreateSiteForm();

		const databaseEngineSelect = screen.getByLabelText( 'Database engine' ) as HTMLSelectElement;
		await waitFor( () => expect( databaseEngineSelect.value ).toBe( 'mysql' ) );

		fireEvent.submit( container.querySelector( 'form' ) as HTMLFormElement );

		expect( onSubmit ).toHaveBeenCalledWith(
			expect.objectContaining< Partial< CreateSiteFormValues > >( {
				databaseEngine: 'mysql',
			} )
		);
	} );

	it( 'keeps an explicit user selection when the default resolves later', async () => {
		let resolveDefaultDatabaseEngine: ( value: 'sqlite' ) => void;
		mockGetDefaultDatabaseEngine.mockReturnValue(
			new Promise( ( resolve ) => {
				resolveDefaultDatabaseEngine = resolve;
			} )
		);
		const user = userEvent.setup();
		const { container, onSubmit } = renderCreateSiteForm();
		const databaseEngineSelect = screen.getByLabelText( 'Database engine' ) as HTMLSelectElement;

		await user.selectOptions( databaseEngineSelect, 'mysql' );
		resolveDefaultDatabaseEngine!( 'sqlite' );

		await waitFor( () => expect( databaseEngineSelect.value ).toBe( 'mysql' ) );
		fireEvent.submit( container.querySelector( 'form' ) as HTMLFormElement );

		expect( onSubmit ).toHaveBeenCalledWith(
			expect.objectContaining< Partial< CreateSiteFormValues > >( {
				databaseEngine: 'mysql',
			} )
		);
	} );

	it( 'submits SQLite when sandbox runtime forces the visible database engine', async () => {
		mockGetDefaultDatabaseEngine.mockResolvedValue( 'mysql' );
		const user = userEvent.setup();
		const { container, onSubmit } = renderCreateSiteForm();

		const databaseEngineSelect = screen.getByLabelText( 'Database engine' ) as HTMLSelectElement;
		await waitFor( () => expect( databaseEngineSelect.value ).toBe( 'mysql' ) );

		await user.selectOptions( screen.getByLabelText( 'PHP runtime' ), 'playground' );

		expect( databaseEngineSelect ).toBeDisabled();
		expect( databaseEngineSelect.value ).toBe( 'sqlite' );

		fireEvent.submit( container.querySelector( 'form' ) as HTMLFormElement );

		expect( onSubmit ).toHaveBeenCalledWith(
			expect.objectContaining< Partial< CreateSiteFormValues > >( {
				runtime: 'playground',
				databaseEngine: 'sqlite',
			} )
		);
	} );
} );
