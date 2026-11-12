import { getSitesDescriptor, type SitesProviderId } from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { EllipsisIcon } from 'lucide-react';
import { useConnector } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { SiteCard, RelativeTime, getWebsiteThumbnailUrl } from '@/features/site-card';
import { DisconnectIcon, DuplicateIcon, ExternalLinkIcon } from '@/lib/icons';
import {
	Button,
	Field,
	FieldGroup,
	FieldSet,
	FieldTitle,
	IconButton,
	Menu,
	VisuallyHidden,
} from '@/lib/ui';
import { lastPublished, siteAddress, type Website } from './options';
import styles from './style.module.css';
import type { ReactNode, RefObject } from 'react';

function InfoRow( { title, children }: { title: string; children: ReactNode } ) {
	return (
		<Field orientation="horizontal" className={ styles.connectedSiteRow }>
			<FieldTitle>{ title }</FieldTitle>
			<span className={ styles.siteValue }>{ children }</span>
		</Field>
	);
}

export function ConnectedWebsite( {
	provider,
	website,
	disabled,
	onDisconnect,
	actionsRef,
	open,
}: {
	provider: SitesProviderId;
	website: Website;
	disabled: boolean;
	onDisconnect: () => void;
	actionsRef: RefObject< HTMLButtonElement | null >;
	open: boolean;
} ) {
	const connector = useConnector();
	const { copied, copy } = useCopyText( website.url );
	const sites = getSitesDescriptor( provider );
	return (
		<FieldSet aria-label={ __( 'Website' ) }>
			<SiteCard
				thumbnailUrl={ getWebsiteThumbnailUrl( website.url ) }
				title={ siteAddress( website ) }
				updatedAt={ lastPublished( website ) }
				active={ open }
				description={ __( 'Not published yet' ) }
				actions={
					<Menu.Root modal={ false }>
						<Menu.Trigger
							render={
								<IconButton
									ref={ actionsRef }
									variant="muted-ghost"
									size="icon-sm"
									icon={ <EllipsisIcon /> }
									label={ __( 'Website actions' ) }
									disabled={ disabled }
								/>
							}
						/>
						<Menu.Popup side="right" align="start">
							<Menu.Item onClick={ () => void connector.openExternalUrl( website.url ) }>
								<ExternalLinkIcon />
								{ __( 'Visit site' ) }
							</Menu.Item>
							<Menu.Item onClick={ copy }>
								<DuplicateIcon />
								{ __( 'Copy link' ) }
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item destructive disabled={ disabled } onClick={ onDisconnect }>
								<DisconnectIcon />
								{ __( 'Disconnect…' ) }
							</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				}
			/>
			<VisuallyHidden role="status" aria-live="polite">
				{ copied ? __( 'Copied' ) : '' }
			</VisuallyHidden>
			<FieldGroup className={ styles.connectedSiteDetails }>
				{ sites.details( website ).map( ( detail ) => (
					<InfoRow key={ detail.title } title={ detail.title }>
						{ detail.value }
					</InfoRow>
				) ) }
				{ website.lastPullTimestamp ? (
					<InfoRow title={ __( 'Last pulled' ) }>
						<RelativeTime timestamp={ website.lastPullTimestamp } active={ open } />
					</InfoRow>
				) : null }
				{ sites.links( website ).map( ( link ) => (
					<Button
						key={ link.title }
						variant="ghost"
						size="default"
						className={ styles.siteLink }
						onClick={ () => void connector.openExternalUrl( link.url ) }
					>
						{ link.title }
						<ExternalLinkIcon />
					</Button>
				) ) }
			</FieldGroup>
		</FieldSet>
	);
}
