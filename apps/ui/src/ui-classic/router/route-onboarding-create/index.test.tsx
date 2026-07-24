import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateSitePage } from './index';
import type { SelectedBlueprint } from '@/components/blueprint-upload';
import type { CreateSiteFormValues } from '@/components/create-site-form';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn( async () => undefined ),
	setProgress: vi.fn(),
	mutateAsync: vi.fn(),
	startSite: vi.fn(),
	cleanup: vi.fn( async () => undefined ),
	proposedName: 'My Studio Site',
	formProps: null as Record< string, unknown > | null,
	uploadProps: null as Record< string, unknown > | null,
} ) );

vi.mock( '@tanstack/react-router', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@tanstack/react-router') >();
	return { ...actual, useNavigate: () => mocks.navigate };
} );

vi.mock( '../layout-onboarding', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('../layout-onboarding') >();
	return { ...actual, useOnboardingProgress: () => ( { setProgress: mocks.setProgress } ) };
} );

vi.mock( '@/components/blueprint-upload', () => ( {
	BlueprintUpload: ( props: Record< string, unknown > ) => {
		mocks.uploadProps = props;
		return <div data-testid="blueprint-upload" />;
	},
} ) );

vi.mock( '@/components/create-site-form', () => ( {
	CreateSiteForm: ( props: Record< string, unknown > ) => {
		mocks.formProps = props;
		return (
			<>
				<button
					type="button"
					onClick={ () =>
						( props.onSubmit as ( values: CreateSiteFormValues ) => void )( formValues )
					}
				>
					Submit
				</button>
				{ props.submitError ? <p>{ String( props.submitError ) }</p> : null }
			</>
		);
	},
} ) );

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: () => ( { cleanupBlueprintTempDir: mocks.cleanup } ),
	};
} );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: () => [],
	useProposedSiteName: () => ( { data: mocks.proposedName } ),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: [] } ),
	useCreateSite: () => ( { mutateAsync: mocks.mutateAsync, isPending: false } ),
	useStartSite: () => ( { mutate: mocks.startSite } ),
} ) );

const formValues: CreateSiteFormValues = {
	name: 'My Site',
	path: '/sites/my-site',
	phpVersion: '8.3',
	wpVersion: 'latest',
	enableHttps: false,
	adminUsername: 'admin',
	adminPassword: 'password',
	adminEmail: 'admin@example.com',
};

function blueprint( name: string, tempDir?: string ): SelectedBlueprint {
	return {
		title: name,
		excerpt: '',
		blueprint: { meta: { title: name, author: 'Studio' } },
		file: { name: `${ name }.zip`, size: 10 },
		filePath: tempDir ? `${ tempDir }/blueprint.json` : undefined,
		tempDir,
	};
}

describe( 'CreateSitePage', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.formProps = null;
		mocks.uploadProps = null;
		mocks.proposedName = 'My Studio Site';
		mocks.mutateAsync.mockResolvedValue( { id: 'site-1' } );
	} );

	it( 'creates a blank site without a Blueprint payload', async () => {
		render( <CreateSitePage /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );

		await waitFor( () => expect( mocks.mutateAsync ).toHaveBeenCalledOnce() );
		expect( mocks.mutateAsync.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'blueprint' );
		expect( mocks.startSite ).toHaveBeenCalledWith( 'site-1' );
		expect( mocks.navigate ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/new',
			params: { siteId: 'site-1' },
		} );
	} );

	it( 'keeps the submitted suggestions visible until navigation completes', async () => {
		let finishNavigation: () => void = () => undefined;
		mocks.navigate.mockImplementationOnce(
			() =>
				new Promise< undefined >( ( resolve ) => {
					finishNavigation = () => resolve( undefined );
				} )
		);
		const { rerender } = render( <CreateSitePage /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		await waitFor( () => expect( mocks.navigate ).toHaveBeenCalledOnce() );

		mocks.proposedName = 'My Next Studio Site';
		rerender( <CreateSitePage /> );

		expect( mocks.formProps?.initialValues ).toEqual( { name: 'My Studio Site' } );
		expect( mocks.formProps?.isSubmitting ).toBe( true );
		await act( async () => finishNavigation() );
	} );

	it( 'replaces and removes Blueprints while cleaning extracted temporary files', async () => {
		render( <CreateSitePage /> );
		const first = blueprint( 'First', '/tmp/first' );
		const second = blueprint( 'Second', '/tmp/second' );

		act( () => ( mocks.uploadProps?.onSelect as ( value: SelectedBlueprint ) => void )( first ) );
		act( () => ( mocks.uploadProps?.onSelect as ( value: SelectedBlueprint ) => void )( second ) );
		expect( mocks.cleanup ).toHaveBeenCalledWith( '/tmp/first' );

		act( () => ( mocks.uploadProps?.onRemove as () => void )() );
		expect( mocks.cleanup ).toHaveBeenCalledWith( '/tmp/second' );
		expect( mocks.formProps?.submitLabel ).toBeUndefined();
	} );

	it( 'blocks submission while the Blueprint upload is invalid', () => {
		render( <CreateSitePage /> );

		act( () => ( mocks.uploadProps?.onValidityChange as ( isValid: boolean ) => void )( false ) );
		expect( mocks.formProps?.isSubmitDisabled ).toBe( true );

		act( () => ( mocks.uploadProps?.onValidityChange as ( isValid: boolean ) => void )( true ) );
		expect( mocks.formProps?.isSubmitDisabled ).toBe( false );
	} );

	it( 'submits the selected Blueprint and restores the form after failure', async () => {
		mocks.mutateAsync.mockRejectedValue( new Error( 'Creation failed' ) );
		render( <CreateSitePage /> );
		const selected = blueprint( 'Selected', '/tmp/selected' );
		act( () =>
			( mocks.uploadProps?.onSelect as ( value: SelectedBlueprint ) => void )( selected )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );

		await screen.findByText( 'Creation failed' );
		expect( mocks.setProgress ).toHaveBeenCalledWith( 'Creating site…' );
		expect( mocks.setProgress ).toHaveBeenCalledWith( null );
		expect( mocks.mutateAsync ).toHaveBeenCalledWith(
			expect.objectContaining( {
				blueprint: expect.objectContaining( {
					filePath: '/tmp/selected/blueprint.json',
				} ),
			} )
		);
		expect( mocks.cleanup ).toHaveBeenCalledWith( '/tmp/selected' );
		expect( mocks.formProps?.submitLabel ).toBeUndefined();
		expect( mocks.startSite ).not.toHaveBeenCalled();
	} );
} );
