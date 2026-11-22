import { __ } from '@wordpress/i18n';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { ShareStatusIcon, useShareStatus } from '@/features/sharing';
import { UploadIcon } from '@/lib/icons';
import { Button, Tooltip, TooltipTrigger, TooltipContent } from '@/lib/ui';
import type { SiteDetails } from '@/data/core';
export function ShareButton( props: { site: SiteDetails; className?: string } ) {
	const status = useShareStatus( props.site.id );
	return (
		<span className={ props.className }>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={ __( 'Share' ) }
							aria-description={ status.label }
							onClick={ ( event ) =>
								requestHeaderPanel( {
									panel: 'share',
									siteId: props.site.id,
									trigger: event.currentTarget,
								} )
							}
						/>
					}
				>
					<ShareStatusIcon icon={ <UploadIcon /> } status={ status } />
				</TooltipTrigger>
				<TooltipContent side="bottom">{ __( 'Share' ) }</TooltipContent>
			</Tooltip>
		</span>
	);
}

export { PublishButton } from './publish-button';
