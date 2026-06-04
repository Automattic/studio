import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentPill } from './environment-pill';
import type { SyncSite } from '@/data/core';

const mutate = vi.fn();

vi.mock( '@/data/queries/use-sessions', () => ( {
	useSetSessionEnvironment: () => ( { mutate } ),
} ) );

const liveSite: SyncSite = {
	id: 123,
	localSiteId: 'site-1',
	name: 'Example Live',
	url: 'https://example.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'already-connected',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
};

describe( 'EnvironmentPill', () => {
	beforeEach( () => {
		mutate.mockReset();
	} );

	it( 'closes the menu after choosing an environment', async () => {
		render(
			<EnvironmentPill sessionId="session-1" effectiveEnvironment="local" liveSite={ liveSite } />
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Environment: Local' } ) );
		fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Live' } ) );

		expect( mutate ).toHaveBeenCalledWith( 'live' );
		await waitFor( () => {
			expect( screen.queryByRole( 'menuitemradio', { name: 'Live' } ) ).not.toBeInTheDocument();
		} );
	} );
} );
