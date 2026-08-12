import { BackupExtractEvents, ImporterEvents } from '@studio/common/lib/import-export-events';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPendingBackup, peekPendingBackup, setPendingBackup } from '@/lib/pending-backup';
import { OnboardingImportPage } from './index';
import type { CreateSiteFormError, CreateSiteFormValues } from '@/components/create-site-form';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn( async () => undefined ),
	setProgress: vi.fn(),
	getFilePath: vi.fn(),
	createSite: vi.fn(),
	importSite: vi.fn(),
	deleteSite: vi.fn(),
	formProps: null as Record< string, unknown > | null,
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	createRoute: ( config: Record< string, unknown > ) => config,
	useNavigate: () => mocks.navigate,
} ) );

vi.mock( '../layout-onboarding', () => ( {
	onboardingLayoutRoute: {},
	useOnboardingProgress: () => ( { setProgress: mocks.setProgress } ),
} ) );

vi.mock( '@/components/create-site-form', () => ( {
	CreateSiteForm: ( props: Record< string, unknown > ) => {
		mocks.formProps = props;
		const submitError = props.submitError as string | CreateSiteFormError | undefined;
		return (
			<>
				<button
					type="button"
					disabled={ Boolean( props.isSubmitting ) }
					onClick={ () =>
						( props.onSubmit as ( values: CreateSiteFormValues ) => void )( formValues )
					}
				>
					{ String( props.submitLabel ?? 'Import site' ) }
				</button>
				{ submitError && (
					<div role="alert">
						{ typeof submitError === 'string' ? (
							submitError
						) : (
							<>
								<strong>{ submitError.title }</strong>
								<span>{ submitError.message }</span>
								<span>{ submitError.details }</span>
							</>
						) }
					</div>
				) }
			</>
		);
	},
} ) );

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: () => ( { getFilePath: mocks.getFilePath } ),
	};
} );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: () => [],
} ) );

vi.mock( '@/data/queries/use-import-site', () => ( {
	useImportSite: () => ( { mutateAsync: mocks.importSite } ),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useCreateSite: () => ( { mutateAsync: mocks.createSite } ),
	useDeleteSite: () => ( { mutateAsync: mocks.deleteSite } ),
} ) );

const selectedBackup = new File( [ 'backup' ], 'studio-backup-My Store-2026-07-17.zip' );
const formValues: CreateSiteFormValues = {
	name: 'My Store',
	path: '/sites/my-store',
	phpVersion: '8.3',
	wpVersion: 'latest',
	enableHttps: false,
	adminUsername: 'admin',
	adminPassword: 'password',
	adminEmail: 'admin@example.com',
};

async function renderConfiguredImport( file = selectedBackup ) {
	setPendingBackup( file );
	const view = render( <OnboardingImportPage /> );
	await waitFor( () => expect( mocks.formProps ).not.toBeNull() );
	return view;
}

describe( 'OnboardingImportPage', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.formProps = null;
		clearPendingBackup();
		mocks.getFilePath.mockResolvedValue( '/tmp/backup.zip' );
		mocks.createSite.mockResolvedValue( { id: 'site-1' } );
		mocks.importSite.mockResolvedValue( undefined );
		mocks.deleteSite.mockResolvedValue( undefined );
	} );

	it( 'adopts a selected File without resolving it until submit', async () => {
		await renderConfiguredImport();

		expect( mocks.getFilePath ).not.toHaveBeenCalled();
		expect( mocks.formProps?.initialValues ).toEqual( { name: 'My Store' } );
		expect( mocks.formProps?.isSubmitting ).toBe( false );
		expect( peekPendingBackup() ).toBeNull();
	} );

	it( 'redirects direct visits without a selected File to Add a site', async () => {
		render( <OnboardingImportPage /> );

		await waitFor( () =>
			expect( mocks.navigate ).toHaveBeenCalledWith( {
				to: '/onboarding',
				replace: true,
			} )
		);
	} );

	it( 'rolls back a failed import and retries the same File with a fresh path', async () => {
		mocks.getFilePath
			.mockResolvedValueOnce( '/tmp/studio-upload-first/backup.zip' )
			.mockResolvedValueOnce( '/tmp/studio-upload-second/backup.zip' );
		mocks.createSite
			.mockResolvedValueOnce( { id: 'site-1' } )
			.mockResolvedValueOnce( { id: 'site-2' } );
		mocks.importSite.mockRejectedValueOnce( new Error( 'Import exploded' ) );
		await renderConfiguredImport();

		fireEvent.click( screen.getByRole( 'button', { name: 'Import site' } ) );
		await screen.findByText( 'Studio could not import this backup.' );

		expect( mocks.deleteSite ).toHaveBeenCalledWith( { id: 'site-1', deleteFiles: true } );
		expect( mocks.importSite ).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining( {
				siteId: 'site-1',
				backupPath: '/tmp/studio-upload-first/backup.zip',
				onProgress: expect.any( Function ),
			} )
		);
		expect( mocks.formProps?.isSubmitting ).toBe( false );
		expect( mocks.setProgress ).toHaveBeenLastCalledWith( null );
		expect( mocks.formProps?.submitLabel ).toBe( 'Retry import' );
		expect( mocks.formProps?.cancelLabel ).toBe( 'Choose another backup' );
		expect( screen.getByText( /removed the incomplete site/i ) ).toBeVisible();
		expect( screen.getByText( 'Import exploded' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Retry import' } ) );
		await waitFor( () => expect( mocks.importSite ).toHaveBeenCalledTimes( 2 ) );

		expect( mocks.getFilePath ).toHaveBeenCalledTimes( 2 );
		expect( mocks.getFilePath ).toHaveBeenNthCalledWith( 2, selectedBackup );
		expect( mocks.importSite ).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining( {
				siteId: 'site-2',
				backupPath: '/tmp/studio-upload-second/backup.zip',
				onProgress: expect.any( Function ),
			} )
		);
		expect( mocks.navigate ).toHaveBeenLastCalledWith( {
			to: '/sites/$siteId/new',
			params: { siteId: 'site-2' },
		} );
		await waitFor( () => expect( mocks.formProps?.isSubmitting ).toBe( false ) );
	} );

	it( 'shows detailed importer progress in the onboarding notification', async () => {
		mocks.importSite.mockImplementationOnce(
			async ( input: { onProgress?: ( event: ImportEventTuple ) => void } ) => {
				input.onProgress?.( [
					BackupExtractEvents.BACKUP_EXTRACT_PROGRESS,
					{ processedFiles: 1, totalFiles: 4 },
				] );
				input.onProgress?.( [
					ImporterEvents.IMPORT_DATABASE_PROGRESS,
					{ processedFiles: 1, totalFiles: 2 },
				] );
			}
		);
		await renderConfiguredImport();

		fireEvent.click( screen.getByRole( 'button', { name: 'Import site' } ) );

		await waitFor( () => {
			expect( mocks.setProgress ).toHaveBeenCalledWith( 'Extracting… (25%)' );
			expect( mocks.setProgress ).toHaveBeenCalledWith( 'Database… (50%)' );
		} );
	} );

	it( 'restores interaction when resolving the selected File fails', async () => {
		mocks.getFilePath.mockRejectedValue( new Error( 'Upload failed' ) );
		await renderConfiguredImport();

		fireEvent.click( screen.getByRole( 'button', { name: 'Import site' } ) );
		await screen.findByText( 'Studio could not access this backup.' );

		expect( mocks.createSite ).not.toHaveBeenCalled();
		expect( mocks.deleteSite ).not.toHaveBeenCalled();
		expect( mocks.formProps?.isSubmitting ).toBe( false );
		expect( mocks.setProgress ).toHaveBeenLastCalledWith( null );
		expect( screen.getByText( /still available and readable/i ) ).toBeVisible();
		expect( screen.getByText( 'Upload failed' ) ).toBeInTheDocument();
	} );

	it( 'keeps recovery action labels while a retry is active', async () => {
		mocks.getFilePath.mockRejectedValueOnce( new Error( 'Upload failed' ) );
		await renderConfiguredImport();

		fireEvent.click( screen.getByRole( 'button', { name: 'Import site' } ) );
		await screen.findByText( 'Studio could not access this backup.' );

		let resolvePath: ( path: string ) => void = () => undefined;
		mocks.getFilePath.mockImplementationOnce(
			() =>
				new Promise< string >( ( resolve ) => {
					resolvePath = resolve;
				} )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Retry import' } ) );

		expect( mocks.formProps?.isSubmitting ).toBe( true );
		expect( mocks.formProps?.submitLabel ).toBe( 'Retry import' );
		expect( mocks.formProps?.cancelLabel ).toBe( 'Choose another backup' );

		resolvePath( '/tmp/backup.zip' );
		await waitFor( () => expect( mocks.formProps?.isSubmitting ).toBe( false ) );
	} );

	it( 'explains site creation failures without exposing raw details first', async () => {
		mocks.createSite.mockRejectedValue( new Error( 'EACCES: cannot create directory' ) );
		await renderConfiguredImport();

		fireEvent.click( screen.getByRole( 'button', { name: 'Import site' } ) );

		expect( await screen.findByText( 'Studio could not create the site.' ) ).toBeVisible();
		expect( screen.getByText( /Review the site name and local folder/ ) ).toBeVisible();
		expect( screen.getByText( 'EACCES: cannot create directory' ) ).toBeInTheDocument();
		expect( mocks.deleteSite ).not.toHaveBeenCalled();
	} );

	it( 'explains unsafe backup paths with a recovery step', async () => {
		mocks.importSite.mockRejectedValue(
			new Error( 'Failed to import site: absolute path: /wp-content/index.php' )
		);
		await renderConfiguredImport();

		fireEvent.click( screen.getByRole( 'button', { name: 'Import site' } ) );

		expect(
			await screen.findByText( /contains a file path Studio cannot safely restore/ )
		).toBeVisible();
		expect( screen.getByText( /Export the site again/ ) ).toBeVisible();
		expect( mocks.deleteSite ).toHaveBeenCalledWith( { id: 'site-1', deleteFiles: true } );
	} );

	it( 'surfaces rollback failures and restores interaction', async () => {
		mocks.importSite.mockRejectedValue( new Error( 'Invalid backup' ) );
		mocks.deleteSite.mockRejectedValue( new Error( 'Folder is locked' ) );
		await renderConfiguredImport();

		fireEvent.click( screen.getByRole( 'button', { name: 'Import site' } ) );

		expect( await screen.findByText( 'Studio could not finish cleaning up.' ) ).toBeVisible();
		expect( screen.getByText( /could not remove “My Store”/ ) ).toBeVisible();
		expect(
			screen.getByText( /Import error: Invalid backup.*Cleanup error: Folder is locked/s )
		).toBeInTheDocument();
		expect( mocks.formProps?.isSubmitting ).toBe( false );
		expect( mocks.setProgress ).toHaveBeenLastCalledWith( null );
	} );

	it( 'ignores duplicate submissions while work is active', async () => {
		let resolvePath: ( path: string ) => void = () => undefined;
		mocks.getFilePath.mockImplementation(
			() =>
				new Promise< string >( ( resolve ) => {
					resolvePath = resolve;
				} )
		);
		await renderConfiguredImport();
		const submit = mocks.formProps?.onSubmit as ( values: CreateSiteFormValues ) => Promise< void >;

		let firstSubmit: Promise< void > | undefined;
		act( () => {
			firstSubmit = submit( formValues );
			void submit( formValues );
		} );
		expect( mocks.getFilePath ).toHaveBeenCalledOnce();

		resolvePath( '/tmp/backup.zip' );
		await act( async () => firstSubmit );
		expect( mocks.createSite ).toHaveBeenCalledOnce();
	} );
} );
