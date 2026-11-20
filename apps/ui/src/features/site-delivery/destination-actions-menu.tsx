import { getProvider, getProviderSites } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { useConnector, type Snapshot, type SyncSite } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import {
	EllipsisVerticalIcon,
	DuplicateIcon,
	ExternalLinkIcon,
	GlobeIcon,
	TrashIcon,
} from '@/lib/icons';
import { IconButton, Menu } from '@/lib/ui';
import { DisconnectSiteIcon } from './connection-icons';
import { PullPreviewIcon } from './pull-preview-icon';
import type { PublishTarget } from './use-publish-targets';
import type { ComponentProps, ReactNode, Ref } from 'react';

function PublishMenuItem( {
	icon,
	label,
	...props
}: Pick< ComponentProps< typeof Menu.Item >, 'disabled' | 'destructive' | 'onClick' > & {
	icon: ReactNode;
	label: string;
} ) {
	return (
		<Menu.Item { ...props }>
			{ icon }
			{ label }
		</Menu.Item>
	);
}

function CopyLinkMenuItem( { url }: { url: string } ) {
	const { copy } = useCopyText( url, __( 'Link copied' ) );
	return (
		<PublishMenuItem icon={ <DuplicateIcon /> } label={ __( 'Copy link' ) } onClick={ copy } />
	);
}

export function DestinationActionsMenu( {
	selected,
	url,
	disabled,
	openingCheckout,
	openingDialog,
	triggerRef,
	onPullPreview,
	onDeletePreview,
	onDisconnect,
}: {
	selected: PublishTarget;
	url: string;
	disabled: boolean;
	openingCheckout: boolean;
	openingDialog: boolean;
	triggerRef: Ref< HTMLButtonElement >;
	onPullPreview?: () => void;
	onDeletePreview: ( snapshot: Snapshot ) => void;
	onDisconnect: () => void;
} ) {
	const connector = useConnector();
	const remote = selected.remote;
	const descriptor = getProviderSites( selected.provider );
	const wpcomSite = selected.provider === 'wpcom' ? ( remote as SyncSite | undefined ) : undefined;
	const dashboardUrl = remote && descriptor.dashboardUrl?.( remote );
	const domainSettingsUrl =
		remote &&
		( descriptor.domainSettingsUrl?.( remote ) ??
			( selected.provider === 'wpcom' && dashboardUrl ? `${ dashboardUrl }/domains` : undefined ) );
	const hostingLinks = remote
		? descriptor
				.describe( remote )
				.links.filter( ( link ) => link.url !== dashboardUrl && link.url !== domainSettingsUrl )
		: [];

	const label = remote ? __( 'Site actions' ) : __( 'Preview actions' );
	return (
		<Menu.Root>
			<Menu.Trigger
				render={
					<IconButton
						ref={ triggerRef }
						variant="muted-ghost"
						size="icon-sm"
						icon={ <EllipsisVerticalIcon /> }
						label={ label }
						disabled={ openingCheckout }
					/>
				}
			/>
			<Menu.Popup
				align="end"
				aria-label={ selected.remote ? label : selected.label }
				finalFocus={ openingDialog ? false : undefined }
			>
				<CopyLinkMenuItem url={ url } />
				{ remote ? (
					<>
						{ dashboardUrl && (
							<PublishMenuItem
								icon={ <ExternalLinkIcon /> }
								label={ sprintf(
									/* translators: %s: hosting provider name. */
									__( 'Manage on %s' ),
									getProvider( selected.provider ).label
								) }
								onClick={ () => void connector.openExternalUrl( dashboardUrl ) }
							/>
						) }
						{ wpcomSite && ! wpcomSite.isPressable && domainSettingsUrl && (
							<PublishMenuItem
								icon={ <GlobeIcon /> }
								label={ __( 'Manage domains' ) }
								onClick={ () => void connector.openExternalUrl( domainSettingsUrl ) }
							/>
						) }
						{ hostingLinks.map( ( link ) => (
							<PublishMenuItem
								key={ link.url }
								icon={ <ExternalLinkIcon /> }
								label={ link.title }
								onClick={ () => void connector.openExternalUrl( link.url ) }
							/>
						) ) }
						<Menu.Separator />
						<PublishMenuItem
							icon={ <DisconnectSiteIcon /> }
							label={ __( 'Disconnect site…' ) }
							destructive
							disabled={ disabled }
							onClick={ onDisconnect }
						/>
					</>
				) : (
					<>
						{ onPullPreview && (
							<PublishMenuItem
								icon={ <PullPreviewIcon /> }
								label={ __( 'Pull from preview…' ) }
								disabled={ disabled }
								onClick={ onPullPreview }
							/>
						) }
						<Menu.Separator />
						<PublishMenuItem
							icon={ <TrashIcon /> }
							label={ __( 'Delete preview…' ) }
							destructive
							disabled={ disabled }
							onClick={ () => onDeletePreview( selected.snapshot! ) }
						/>
					</>
				) }
			</Menu.Popup>
		</Menu.Root>
	);
}
