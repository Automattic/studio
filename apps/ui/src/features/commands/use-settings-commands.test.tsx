import { act, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSettingCommands } from '@/features/commands/use-setting-commands';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { PaletteCommand } from '@/features/commands/studio-commands';

function setup( collapse: boolean ) {
	const connector = createFakeConnector( {
		preferences: { autoCollapseSites: collapse },
	} );
	const result: { current: PaletteCommand[] } = { current: [] };
	function Probe() {
		result.current = useSettingCommands( 'studio' );
		return null;
	}
	renderWithProviders( <Probe />, { connector } );
	const command = () =>
		result.current.find( ( entry ) => entry.id === 'settings-general-collapse-sidebar-groups' );
	return { connector, command };
}

it.each( [ false, true ] )(
	'flips and refreshes the persisted sidebar preference from %s',
	async ( checked ) => {
		const { connector, command } = setup( checked );
		const label = ( on: boolean ) =>
			on ? 'Turn off “Collapse sidebar groups”' : 'Turn on “Collapse sidebar groups”';
		await waitFor( () => expect( command()?.label ).toBe( label( checked ) ) );
		act( () => command()!.run() );
		await waitFor( () => expect( command()?.label ).toBe( label( ! checked ) ) );
		expect( connector.setUserPreferences ).toHaveBeenCalledWith(
			{ autoCollapseSites: ! checked },
			undefined
		);
	}
);
