import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
	PreviewSitePublishAction,
	PreviewSitesList,
} from '@/components/site-overview-view/preview-sites-section';
import { ShareDialog } from './share-dialog';
import type { SiteDetails } from '@/data/core';

vi.mock( '@/components/site-overview-view/preview-sites-section', () => ( {
	PreviewSitesList: vi.fn( () => <div>Shared preview list</div> ),
	PreviewSitePublishAction: vi.fn( () => <button>Shared publish action</button> ),
} ) );

const SITE = { id: 'riff', name: 'Riff' } as SiteDetails;

describe( 'ShareDialog', () => {
	it( 'renders only the shared preview list and publishing action', () => {
		render( <ShareDialog site={ SITE } open onOpenChange={ vi.fn() } /> );

		expect( screen.getByRole( 'heading', { name: 'Share this site' } ) ).toBeVisible();
		expect( screen.getByText( 'Shared preview list' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Shared publish action' } ) ).toBeVisible();
		expect( screen.queryByText( 'Connections' ) ).not.toBeInTheDocument();
		expect( PreviewSitesList ).toHaveBeenCalledWith( { site: SITE }, undefined );
		expect( PreviewSitePublishAction ).toHaveBeenCalledWith(
			{ site: SITE, presentation: 'dialog' },
			undefined
		);
	} );
} );
