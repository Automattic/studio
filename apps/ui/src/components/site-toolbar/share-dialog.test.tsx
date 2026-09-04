import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionsSection } from '@/components/site-overview-view/connections-section';
import { PreviewSitesSection } from '@/components/site-overview-view/preview-sites-section';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { ShareDialog } from './share-dialog';
import type { SiteDetails } from '@/data/core';

vi.mock( '@/components/site-overview-view/connections-section', () => ( {
	ConnectionsSection: vi.fn( () => <div>Shared connections</div> ),
} ) );
vi.mock( '@/components/site-overview-view/preview-sites-section', () => ( {
	PreviewSitesSection: vi.fn( () => <div>Shared preview sites</div> ),
} ) );
vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteBusy: vi.fn(),
} ) );

const SITE = { id: 'riff', name: 'Riff' } as SiteDetails;

describe( 'ShareDialog', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useIsSiteBusy ).mockReturnValue( false );
	} );

	it( 'renders the same connection and preview sections as Overview', () => {
		render( <ShareDialog site={ SITE } open onOpenChange={ vi.fn() } /> );

		expect( screen.getByRole( 'heading', { name: 'Share this site' } ) ).toBeVisible();
		expect( screen.getByText( 'Shared connections' ) ).toBeVisible();
		expect( screen.getByText( 'Shared preview sites' ) ).toBeVisible();
		expect( ConnectionsSection ).toHaveBeenCalledWith( { site: SITE, busy: false }, undefined );
		expect( PreviewSitesSection ).toHaveBeenCalledWith( { site: SITE }, undefined );
	} );
} );
