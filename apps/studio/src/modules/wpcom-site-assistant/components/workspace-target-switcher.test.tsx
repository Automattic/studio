import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import { WorkspaceTargetSwitcher } from 'src/modules/wpcom-site-assistant/components/workspace-target-switcher';
import type { SyncSite } from '@studio/common/types/sync';
import type { WpcomSiteWorkspace } from 'src/modules/wpcom-site-assistant/lib/workspaces';

const mockOpenURL = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		openURL: mockOpenURL,
	} ),
} ) );

const makeRemoteSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 101,
	localSiteId: '',
	name: 'Remote Site',
	url: 'https://remote-site.example',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

const makeWorkspace = ( productionSite: SyncSite ): WpcomSiteWorkspace => ( {
	id: `workspace:${ productionSite.id }`,
	name: productionSite.name,
	primarySite: productionSite,
	productionSite,
	stagingSites: [],
	sites: [ productionSite ],
} );

const renderSwitcher = ( site: SyncSite, overrides = {} ) => {
	return render(
		<WorkspaceTargetSwitcher
			workspace={ makeWorkspace( site ) }
			selectedWpcomSite={ site }
			onSelectWpcomSite={ vi.fn() }
			onCreateStagingSite={ vi.fn() }
			canCreateStagingSite={ false }
			isCreatingStagingSite={ false }
			{ ...overrides }
		/>
	);
};

describe( 'WorkspaceTargetSwitcher', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'treats a syncable missing Local target as a create affordance', async () => {
		const user = userEvent.setup();
		const remoteSite = makeRemoteSite();
		const onCreateLocalSite = vi.fn();
		renderSwitcher( remoteSite, { onCreateLocalSite } );

		await user.click( screen.getByRole( 'button', { name: 'Local' } ) );

		expect( onCreateLocalSite ).toHaveBeenCalledWith( remoteSite );
		expect( mockOpenURL ).not.toHaveBeenCalled();
	} );

	it.each( [
		[ 'needs-upgrade', 'https://wordpress.com/plans/101' ],
		[ 'needs-transfer', 'https://wordpress.com/hosting-features/101' ],
	] as const )(
		'opens the existing sync support CTA for %s',
		async ( syncSupport, expectedUrl ) => {
			const user = userEvent.setup();
			renderSwitcher( makeRemoteSite( { syncSupport } ), { onCreateLocalSite: vi.fn() } );

			await user.click( screen.getByRole( 'button', { name: 'Local' } ) );

			expect( mockOpenURL ).toHaveBeenCalledWith( expectedUrl );
		}
	);

	it( 'disables unsupported missing Local targets', () => {
		renderSwitcher( makeRemoteSite( { syncSupport: 'unsupported' } ), {
			onCreateLocalSite: vi.fn(),
		} );

		expect( screen.getByRole( 'button', { name: 'Local' } ) ).toBeDisabled();
	} );
} );
