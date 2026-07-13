import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { useAppMenuNavigation } from './use-app-menu-navigation';

const navigate = vi.fn( async () => undefined );
let blueprintListener: ( payload: { blueprintPath: string } ) => void = () => undefined;

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigate,
} ) );

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return { ...actual, useConnector: vi.fn() };
} );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const readBlueprintFile = vi.fn();

describe( 'useAppMenuNavigation', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		const pending = pendingBlueprintSlot.getSnapshot();
		if ( pending ) pendingBlueprintSlot.clear( pending );
		useConnectorMock.mockReturnValue( {
			onAddSite: vi.fn( () => () => undefined ),
			onAddSiteWithBlueprint: vi.fn( ( listener ) => {
				blueprintListener = listener;
				return () => undefined;
			} ),
			onOpenSettings: vi.fn( () => () => undefined ),
			readBlueprintFile,
		} );
	} );

	it( 'hands a Blueprint deep link to the unified Create route', async () => {
		readBlueprintFile.mockResolvedValue( {
			meta: { title: 'Deep-linked Blueprint', author: 'Studio' },
		} );
		renderHook( () => useAppMenuNavigation() );

		act( () => blueprintListener( { blueprintPath: '/tmp/deep-link.json' } ) );

		await waitFor( () => expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding/create' } ) );
		expect( readBlueprintFile ).toHaveBeenCalledWith( '/tmp/deep-link.json' );
		expect( pendingBlueprintSlot.getSnapshot() ).toMatchObject( {
			title: 'Deep-linked Blueprint',
			file: { name: 'deep-link.json' },
		} );
	} );
} );
