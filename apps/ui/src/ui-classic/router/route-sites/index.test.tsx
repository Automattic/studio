import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSites } from '@/data/queries/use-sites';
import { SitesPage } from './index';
import type { ReactNode } from 'react';

vi.mock( '@tanstack/react-router', () => ( {
	Link: ( {
		to,
		params,
		className,
		children,
	}: {
		to: string;
		params?: { siteId?: string };
		className?: string;
		children: ReactNode;
	} ) => {
		const href = params?.siteId ? to.replace( '$siteId', params.siteId ) : to;
		return (
			<a href={ href } className={ className }>
				{ children }
			</a>
		);
	},
	createRoute: () => ( {} ),
} ) );

vi.mock( '../layout-dashboard', () => ( {
	dashboardLayoutRoute: {},
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
} ) );

const useSitesMock = vi.mocked( useSites );

describe( 'SitesPage', () => {
	beforeEach( () => {
		useSitesMock.mockReset();
	} );

	it( 'links site cards to the site overview instead of creating a new chat', () => {
		useSitesMock.mockReturnValue( {
			data: [
				{
					id: 'site-1',
					name: 'Example Site',
					path: '/Users/example/Studio/example-site',
					running: true,
					siteIcon: null,
				},
			],
			isLoading: false,
		} as never );

		render( <SitesPage /> );

		expect( screen.getByRole( 'link', { name: /Example Site/ } ) ).toHaveAttribute(
			'href',
			'/sites/site-1'
		);
	} );
} );
