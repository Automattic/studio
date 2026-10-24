import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './index';
import type { Connector, SiteDetails } from '@/data/core';

const SITE: SiteDetails = {
	id: 'site-1',
	name: 'Ada Portfolio',
	path: '/sites/ada-portfolio',
	port: 8881,
	running: false,
	phpVersion: '8.4',
};

// Subscriptions do nothing and every other request stays in flight, so the
// index route never finishes resolving its redirect.
function createConnector( overrides: Partial< Connector > ): Connector {
	return new Proxy( overrides, {
		get: ( target, key: string ) =>
			key in target
				? target[ key as keyof Connector ]
				: key.startsWith( 'on' )
				? () => () => {}
				: () => new Promise( () => {} ),
	} ) as Connector;
}

describe( 'App', () => {
	it( 'shows the sidebar with its sites while the index route resolves', async () => {
		render(
			<App
				connector={ createConnector( {
					getSites: async () => [ SITE ],
					getUserPreferences: async () => ( { agenticFeaturesEnabled: true } ),
				} as Partial< Connector > ) }
			/>
		);

		expect( await screen.findByText( 'Ada Portfolio' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Something went wrong!' ) ).not.toBeInTheDocument();
	} );
} );
