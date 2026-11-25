import { IconButton, Menu } from '@studio/ds';
import { EllipsisVerticalIcon, DuplicateIcon, ExternalLinkIcon, TrashIcon } from '@studio/ds/icons';
import { getProviderSites } from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { useConnector, type Snapshot } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { DisconnectSiteIcon } from './connection-icons';
import { PullPreviewIcon } from './pull-preview-icon';
import styles from './style.module.css';
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
	const hostingLinks = remote ? descriptor.describe( remote ).links : [];

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
						{ hostingLinks.map( ( link ) => (
							<PublishMenuItem
								key={ link.url }
								icon={
									link.icon ? (
										<span
											className={ styles.linkIcon }
											dangerouslySetInnerHTML={ { __html: link.icon } }
										/>
									) : (
										<ExternalLinkIcon />
									)
								}
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
