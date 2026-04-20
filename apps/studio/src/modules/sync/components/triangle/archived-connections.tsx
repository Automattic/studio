import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import {
	useDisconnectSiteMutation,
	useUpdateConnectedSiteSlotMutation,
} from 'src/stores/sync/connected-sites';
import type { SyncSite } from '@studio/common/types/sync';

type Props = {
	localSiteId: string;
	archived: SyncSite[];
	isProductionOpen: boolean;
	isStagingOpen: boolean;
};

function stripProtocol( url: string ): string {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

export function ArchivedConnections( props: Props ) {
	const [ open, setOpen ] = useState( false );
	const [ updateSlot ] = useUpdateConnectedSiteSlotMutation();
	const [ disconnect ] = useDisconnectSiteMutation();

	if ( props.archived.length === 0 ) return null;

	return (
		<details
			open={ open }
			onToggle={ ( e ) => setOpen( ( e.currentTarget as HTMLDetailsElement ).open ) }
		>
			<summary className="cursor-pointer text-sm text-gray-500">
				{ __( 'Archived connections' ) } ({ props.archived.length })
			</summary>
			<ul className="mt-2 space-y-1">
				{ props.archived.map( ( s ) => (
					<li
						key={ s.id }
						className="flex items-center justify-between rounded border border-gray-100 p-2 text-sm dark:border-gray-700"
					>
						<span>
							{ s.name } <span className="text-gray-500">{ stripProtocol( s.url ) }</span>
						</span>
						<div className="flex gap-2">
							{ props.isProductionOpen && (
								<Button
									variant="tertiary"
									onClick={ () =>
										updateSlot( {
											localSiteId: props.localSiteId,
											siteId: s.id,
											slotOverride: 'production',
										} )
									}
								>
									{ __( 'Move to Production' ) }
								</Button>
							) }
							{ props.isStagingOpen && (
								<Button
									variant="tertiary"
									onClick={ () =>
										updateSlot( {
											localSiteId: props.localSiteId,
											siteId: s.id,
											slotOverride: 'staging',
										} )
									}
								>
									{ __( 'Move to Staging' ) }
								</Button>
							) }
							<Button
								variant="tertiary"
								isDestructive
								onClick={ () => disconnect( { siteId: s.id, localSiteId: props.localSiteId } ) }
							>
								{ __( 'Disconnect' ) }
							</Button>
						</div>
					</li>
				) ) }
			</ul>
		</details>
	);
}
