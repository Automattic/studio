import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { createSelectedBlueprint } from '@/lib/blueprint-selection';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';

export function useAppMenuNavigation() {
	const connector = useConnector();
	const navigate = useNavigate();

	useEffect(
		() => connector.onAddSite( () => void navigate( { to: '/onboarding' } ) ),
		[ connector, navigate ]
	);
	useEffect(
		() =>
			connector.onAddSiteWithBlueprint( ( { blueprintPath } ) => {
				void ( async () => {
					try {
						const blueprintJson = await connector.readBlueprintFile( blueprintPath );
						const blueprint = await createSelectedBlueprint( blueprintJson, {
							name: blueprintPath.split( /[\\/]/ ).pop() || 'blueprint.json',
							size: 0,
						} );
						pendingBlueprintSlot.set( blueprint );
						await navigate( { to: '/onboarding/create' } );
					} catch ( error ) {
						console.error( 'Failed to open Blueprint deep link:', error );
						const ipcApi = (
							window as unknown as {
								ipcApi?: {
									showErrorMessageBox( options: {
										title: string;
										message: string;
										error?: unknown;
										showOpenLogs?: boolean;
									} ): void;
								};
							}
						 ).ipcApi;
						ipcApi?.showErrorMessageBox( {
							title: __( 'Failed to load Blueprint' ),
							message: __(
								'Studio could not open the Blueprint. Please check the file and try again.'
							),
							error,
							showOpenLogs: true,
						} );
					}
				} )();
			} ),
		[ connector, navigate ]
	);
	useEffect(
		() => connector.onOpenSettings( () => void navigate( { to: '/settings' } ) ),
		[ connector, navigate ]
	);
}
