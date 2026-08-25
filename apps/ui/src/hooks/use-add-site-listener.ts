import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { createSelectedBlueprint } from '@/lib/blueprint-selection';
import { setPendingBlueprint } from '@/lib/pending-blueprint';

/**
 * Bridges renderer-external "add a site" requests into the router. Two
 * sources, both originating in the main process:
 *
 * - The File ▸ Add Site… menu item (⌘N) fires a plain `add-site` event —
 *   navigate to the onboarding flow picker.
 * - A `wp-studio://add-site?blueprint_url=…` deep link fires
 *   `add-site-with-blueprint` with the path of a blueprint JSON the main
 *   process already downloaded and validated. Load it, stash it in the
 *   pending-blueprint slot, and land on the create-site form.
 *
 * Must be mounted inside the RouterProvider (it navigates); the classic
 * router's root layout is the canonical spot.
 */
export function useAddSiteListener(): void {
	const connector = useConnector();
	const navigate = useNavigate();

	useEffect( () => {
		return connector.onAddSite( () => {
			void navigate( { to: '/onboarding' } );
		} );
	}, [ connector, navigate ] );

	useEffect( () => {
		return connector.onAddSiteWithBlueprint( async ( { blueprintPath } ) => {
			try {
				const blueprintJson = await connector.readBlueprintFile( blueprintPath );
				const blueprint = await createSelectedBlueprint( blueprintJson, {
					name: blueprintPath.split( /[\\/]/ ).pop() || 'blueprint.json',
					size: 0,
				} );
				setPendingBlueprint( blueprint );
				void navigate( { to: '/onboarding/create' } );
			} catch ( error ) {
				console.error( 'Failed to load blueprint from deep link:', error );
			}
		} );
	}, [ connector, navigate ] );
}
