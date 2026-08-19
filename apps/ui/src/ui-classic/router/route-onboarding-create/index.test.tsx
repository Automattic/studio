import { act, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateSitePage } from './index';
import type { SelectedBlueprint } from '@/components/blueprint-upload';
import type { CreateSiteFormValues } from '@/components/create-site-form';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn( async () => undefined ),
	setProgress: vi.fn(),
	mutateAsync: vi.fn(),
	deleteSite: vi.fn( async () => undefined ),
	cleanup: vi.fn( async () => undefined ),
	proposedName: 'My Studio Site',
	chatEnabled: true,
	formProps: null as Record< string, unknown > | null,
	uploadProps: null as Record< string, unknown > | null,
	generation: vi.fn( async ( _options: unknown ) => ( {
		session: { id: 'session-1' },
		sessionIds: [],
		runIds: [],
	} ) ),
	submission: null as { prompt: string; attachments: Record< string, unknown > } | null,
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
				{ props.children as React.ReactNode }
				{ props.submitError ? <p>{ String( props.submitError ) }</p> : null }
			</>
		);
	},
} ) );

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: () => ( {
			cleanupBlueprintTempDir: mocks.cleanup,
			deleteSite: mocks.deleteSite,
		} ),
	};
} );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: () => ( { chatEnabled: mocks.chatEnabled } ),
} ) );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: () => [],
	useProposedSiteName: () => ( { data: mocks.proposedName } ),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: [] } ),
	useCreateSite: () => ( { mutateAsync: mocks.mutateAsync, isPending: false } ),
} ) );

vi.mock( '@/ui-classic/components/session-view/composer', () => ( {
	Composer: forwardRef< unknown, Record< string, unknown > >( function MockComposer( props, ref ) {
		useImperativeHandle( ref, () => ( { getSubmission: () => mocks.submission } ) );
		return (
			<input
				data-testid="composer"
				onChange={ ( event ) =>
					( props.onDraftChange as ( text: string, hasAttachments: boolean ) => void )(
						event.target.value,
						false
					)
				}
			/>
		);
	} ),
} ) );

vi.mock( './generation', () => ( {
	startConcurrentDesignGeneration: ( options: unknown ) => mocks.generation( options ),
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
		mocks.chatEnabled = true;
		mocks.submission = null;
		mocks.mutateAsync.mockResolvedValue( { id: 'site-1' } );
		mocks.generation.mockResolvedValue( {
			session: { id: 'session-1' },
			sessionIds: [],
			runIds: [],
		} );
	} );

	it( 'creates a blank site without a brief or Blueprint payload', async () => {
		render( <CreateSitePage /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );

		await vi.waitFor( () => expect( mocks.mutateAsync ).toHaveBeenCalledOnce() );
		expect( mocks.mutateAsync.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'blueprint' );
		expect( mocks.mutateAsync.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'flowType' );
		expect( mocks.navigate ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/new',
			params: { siteId: 'site-1' },
		} );
	} );

	it( 'shows the AI brief composer when chat is enabled and no Blueprint is selected', () => {
		render( <CreateSitePage /> );
		expect( screen.getByTestId( 'composer' ) ).toBeInTheDocument();
	} );

	it( 'hides the AI brief composer when chat is disabled', () => {
		mocks.chatEnabled = false;
		render( <CreateSitePage /> );
		expect( screen.queryByTestId( 'composer' ) ).not.toBeInTheDocument();
	} );

	it( 'hides the AI brief composer once a Blueprint is selected', () => {
		render( <CreateSitePage /> );
		act( () =>
			( mocks.uploadProps?.onSelect as ( value: SelectedBlueprint ) => void )(
				blueprint( 'Selected' )
			)
		);
		expect( screen.queryByTestId( 'composer' ) ).not.toBeInTheDocument();
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
	} );

	it( 'runs the AI design generation flow when a brief is provided and no Blueprint is selected', async () => {
		mocks.submission = { prompt: 'A bakery site', attachments: {} };
		render( <CreateSitePage /> );

		fireEvent.change( screen.getByTestId( 'composer' ), { target: { value: 'A bakery site' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );

		await vi.waitFor( () => expect( mocks.mutateAsync ).toHaveBeenCalledOnce() );
		expect( mocks.mutateAsync ).toHaveBeenCalledWith(
			expect.objectContaining( { flowType: 'ai' } )
		);
		await vi.waitFor( () => expect( mocks.generation ).toHaveBeenCalledOnce() );
		expect( mocks.navigate ).toHaveBeenCalledWith( {
			to: '/sessions/$sessionId',
			params: { sessionId: 'session-1' },
		} );
	} );

	it( 'falls back to a plain create when the brief is empty even with chat enabled', async () => {
		mocks.submission = { prompt: '', attachments: {} };
		render( <CreateSitePage /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );

		await vi.waitFor( () => expect( mocks.mutateAsync ).toHaveBeenCalledOnce() );
		expect( mocks.mutateAsync.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'flowType' );
		expect( mocks.generation ).not.toHaveBeenCalled();
	} );
} );
