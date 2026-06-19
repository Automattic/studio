import { generateDefaultBlueprintDescription } from '@studio/common/lib/blueprint-settings';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { setPendingBlueprint } from '@/lib/pending-blueprint';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

/**
 * Bridges renderer-external "add a site" requests into the router. Two
 * sources, both originating in the main process:
 *
 * - The File ▸ Add Site… menu item (⌘N) fires a plain `add-site` event —
 *   navigate to the onboarding flow picker.
 * - A `wp-studio://add-site?blueprint_url=…` deep link fires
 *   `add-site-with-blueprint` with the path of a blueprint JSON the main
 *   process already downloaded and validated. Load it, stash it in the
 *   pending-blueprint slot, and land directly on the configure step.
 *
 * Must be mounted inside the RouterProvider (it navigates); the classic
 * router's root layout is the canonical spot.
 */
export function useAddSiteListener(): void {
	const connector = useConnector();
	const navigate = useNavigate();

	useEffect( () => {
		return connector.onAddSiteRequested( () => {
			void navigate( { to: '/onboarding' } );
		} );
	}, [ connector, navigate ] );

	useEffect( () => {
		return connector.onAddSiteWithBlueprint( async ( { blueprintPath } ) => {
			try {
				const blueprintJson = await connector.readBlueprintFile( blueprintPath );
				const blueprint = blueprintJson as BlueprintV1Declaration;
				const meta = ( blueprintJson as { meta?: { title?: string; description?: string } } ).meta;

				setPendingBlueprint( {
					title: meta?.title || __( 'Blueprint' ),
					excerpt: meta?.description || generateDefaultBlueprintDescription( blueprint ),
					blueprint,
				} );
				void navigate( {
					to: '/onboarding/blueprint',
					search: { step: 'configure' },
				} );
			} catch ( error ) {
				console.error( 'Failed to load blueprint from deep link:', error );
			}
		} );
	}, [ connector, navigate ] );
}
