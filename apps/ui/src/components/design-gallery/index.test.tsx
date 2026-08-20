import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useSelectDesignArtifact } from '@/data/queries/use-design-project';
import { DesignGallery } from './index';
import type { Annotation } from '@/components/site-preview';
import type { SiteDetails } from '@/data/core';
import type { DesignProject } from '@studio/common/design-project';
import type { ReactNode } from 'react';

const selectArtifact = vi.hoisted( () => vi.fn().mockResolvedValue( undefined ) );
const renderedPreviewPaths: string[] = [];
const renderedPreviewCacheKeys: string[][] = [];

class ResizeObserverMock {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

global.ResizeObserver = ResizeObserverMock;

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-design-project', () => ( {
	useSelectDesignArtifact: vi.fn(),
} ) );

vi.mock( '@/components/dot-grid', () => ( {
	DotGrid: () => <div data-testid="dot-grid" />,
} ) );

vi.mock( '@/ui-classic/components/session-view/empty-background', () => ( {
	EmptyBackground: () => <div data-testid="empty-background" />,
} ) );

vi.mock( '@/components/site-preview', () => ( {
	SitePreview: ( props: {
		path: string;
		onAnnotationsDone?: ( annotations: Annotation[] ) => void;
		locationContent?: ReactNode;
		contentOverride?: ReactNode;
		navigationKey?: string;
		cachedPreviews?: readonly { key: string; path: string }[];
	} ) => {
		renderedPreviewPaths.push( props.path );
		renderedPreviewCacheKeys.push( props.cachedPreviews?.map( ( preview ) => preview.key ) ?? [] );
		return (
			<div>
				{ props.locationContent }
				<div
					data-testid="site-preview"
					data-path={ props.path }
					data-navigation-key={ props.navigationKey }
				>
					{ props.contentOverride }
					<button
						type="button"
						onClick={ () =>
							props.onAnnotationsDone?.( [
								{ id: 'annotation-1', comment: 'Increase the heading contrast', tag: 'h1' },
							] )
						}
					>
						Submit annotation
					</button>
				</div>
			</div>
		);
	},
} ) );

const site: SiteDetails = {
	id: 'site-1',
	name: 'Example Site',
	path: '/Users/example/Studio/example-site',
	port: 8881,
	running: true,
	phpVersion: '8.3',
};

const project: DesignProject = {
	schema: 'studio/design-project/v1',
	projectId: 'project-1',
	siteId: site.id,
	sessionId: 'session-1',
	phase: 'directions',
	manifestRevision: 3,
	brief: 'Build a bold studio site',
	artifacts: [
		{
			id: 'direction-1',
			revision: 1,
			kind: 'direction',
			label: 'Editorial',
			rationale: 'A restrained editorial direction.',
			path: 'artifacts/directions/editorial/index.html',
			digest: `sha256:${ 'a'.repeat( 64 ) }`,
			createdAt: '2026-08-18T12:00:00.000Z',
		},
		{
			id: 'direction-2',
			revision: 2,
			kind: 'direction',
			label: 'Playful',
			rationale: 'A colorful expressive direction.',
			path: 'artifacts/directions/playful/index.html',
			digest: `sha256:${ 'b'.repeat( 64 ) }`,
			createdAt: '2026-08-18T12:01:00.000Z',
		},
	],
	selectedArtifactId: null,
	acceptedArtifactId: null,
	materialization: {
		status: 'not-started',
		reportPath: null,
		themeSlug: null,
		error: null,
	},
	createdAt: '2026-08-18T12:00:00.000Z',
	updatedAt: '2026-08-18T12:02:00.000Z',
};

describe( 'DesignGallery', () => {
	beforeEach( () => {
		selectArtifact.mockClear();
		renderedPreviewPaths.length = 0;
		renderedPreviewCacheKeys.length = 0;
	} );

	it( 'uses the animated W behind focused parallel-generation copy', () => {
		vi.mocked( useConnector ).mockReturnValue( { continueSession: vi.fn() } as never );
		vi.mocked( useSelectDesignArtifact ).mockReturnValue( {
			mutateAsync: selectArtifact,
		} as never );

		render( <DesignGallery site={ site } project={ { ...project, artifacts: [] } } /> );

		expect( screen.getByTestId( 'empty-background' ) ).toBeVisible();
		expect( screen.getByText( 'Creating three design directions' ) ).toBeVisible();
		expect( screen.getByText( /exploring three ideas in parallel/i ) ).toBeVisible();
	} );

	it( 'navigates directly to a newly selected design without loading another path first', () => {
		vi.mocked( useConnector ).mockReturnValue( { continueSession: vi.fn() } as never );
		vi.mocked( useSelectDesignArtifact ).mockReturnValue( {
			mutateAsync: selectArtifact,
		} as never );

		render(
			<DesignGallery
				site={ site }
				project={ { ...project, selectedArtifactId: 'direction-1' } }
				sessionId="session-1"
			/>
		);

		renderedPreviewPaths.length = 0;
		fireEvent.click( screen.getByRole( 'tab', { name: 'Playful' } ) );

		expect( renderedPreviewPaths ).toEqual( [
			'/.studio/design/artifacts/directions/playful/index.html?revision=3',
		] );
		expect( screen.getByTestId( 'site-preview' ) ).toHaveAttribute(
			'data-navigation-key',
			'direction-2'
		);
	} );

	it( 'starts with every option visible and opens one in the shared site preview', () => {
		vi.mocked( useConnector ).mockReturnValue( { continueSession: vi.fn() } as never );
		vi.mocked( useSelectDesignArtifact ).mockReturnValue( {
			mutateAsync: selectArtifact,
		} as never );

		render( <DesignGallery site={ site } project={ project } sessionId="session-1" /> );

		expect( screen.getByRole( 'tab', { name: 'All options' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		expect( screen.getByRole( 'button', { name: /Editorial/ } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: /Playful/ } ) ).toBeVisible();
		expect( screen.queryByText( 'Request changes' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Choose a direction' ) ).not.toBeInTheDocument();
		expect( renderedPreviewCacheKeys.at( -1 ) ).toEqual( [ 'direction-1', 'direction-2' ] );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Editorial' } ) );

		expect( screen.getByTestId( 'site-preview' ) ).toHaveAttribute(
			'data-path',
			'/.studio/design/artifacts/directions/editorial/index.html?revision=3'
		);
		expect( screen.getByRole( 'button', { name: 'Build this design' } ) ).toBeVisible();
		expect(
			screen.getByText( 'Studio will turn this design into an editable WordPress theme.' )
		).toBeVisible();
		expect( screen.queryByText( 'A restrained editorial direction.' ) ).not.toBeInTheDocument();
	} );

	it( 'selects the inspected option before forwarding annotations to chat', async () => {
		const onAnnotationsDone = vi.fn();
		vi.mocked( useConnector ).mockReturnValue( { continueSession: vi.fn() } as never );
		vi.mocked( useSelectDesignArtifact ).mockReturnValue( {
			mutateAsync: selectArtifact,
		} as never );

		render(
			<DesignGallery
				site={ site }
				project={ project }
				sessionId="session-1"
				onAnnotationsDone={ onAnnotationsDone }
			/>
		);

		fireEvent.click( screen.getByRole( 'tab', { name: 'Playful' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit annotation' } ) );

		await waitFor( () => expect( selectArtifact ).toHaveBeenCalledWith( 'direction-2' ) );
		expect( onAnnotationsDone ).toHaveBeenCalledWith(
			[ { id: 'annotation-1', comment: 'Increase the heading contrast', tag: 'h1' } ],
			{ designArtifactId: 'direction-2', designArtifactLabel: 'Playful' }
		);
	} );

	it( 'keeps revisions in one tab and opens its version menu from the active tab', async () => {
		vi.mocked( useConnector ).mockReturnValue( { continueSession: vi.fn() } as never );
		vi.mocked( useSelectDesignArtifact ).mockReturnValue( {
			mutateAsync: selectArtifact,
		} as never );
		const revisedProject: DesignProject = {
			...project,
			selectedArtifactId: 'direction-3',
			artifacts: [
				...project.artifacts,
				{
					...project.artifacts[ 0 ],
					id: 'direction-3',
					revision: 3,
					parentArtifactId: 'direction-1',
					path: 'artifacts/directions/editorial-r2/index.html',
					digest: `sha256:${ 'c'.repeat( 64 ) }`,
				},
			],
		};

		render( <DesignGallery site={ site } project={ revisedProject } sessionId="session-1" /> );

		expect( screen.getAllByRole( 'tab', { name: 'Editorial' } ) ).toHaveLength( 1 );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Editorial' } ) );

		expect( await screen.findByText( 'Versions' ) ).toBeVisible();
		expect( screen.getByRole( 'menuitemradio', { name: 'Version 1' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'menuitemradio', { name: 'Version 1' } ) );
		expect( screen.getByTestId( 'site-preview' ) ).toHaveAttribute(
			'data-navigation-key',
			'direction-1'
		);
	} );
} );
