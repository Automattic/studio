import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppRouter } from './router';
import type { ReactNode } from 'react';

vi.mock( '@/ui-desks/desk', () => ( {
	Desk: () => null,
} ) );

vi.mock( '@/data/wordpress/provider', () => ( {
	WordPressDataProvider: ( { children }: { children: ReactNode } ) => children,
} ) );

describe( 'createAppRouter', () => {
	it( 'registers embedded site Desk routes in the Agentic shell', () => {
		const router = createAppRouter( {
			connector: {} as never,
			queryClient: new QueryClient(),
		} );

		expect( router.routesByPath[ '/sites/$siteId' ] ).toBeDefined();
	} );
} );
