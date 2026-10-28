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
import {
	backupsUrl,
	dashboardUrl,
	domainsUrl,
	websiteAddress,
	websiteEnvironmentLabel,
} from './options';
import styles from './style.module.css';
import type { SyncSite } from '@/data/core';
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
	website,
	disabled,
	onDisconnect,
	actionsRef,
	open,
}: {
	website: SyncSite;
	disabled: boolean;
	onDisconnect: () => void;
	actionsRef: RefObject< HTMLButtonElement | null >;
	open: boolean;
} ) {
	const connector = useConnector();
	const { copied, copy } = useCopyText( website.url );
	const backups = backupsUrl( website );
	const dashboard = dashboardUrl( website );
	const domains = domainsUrl( website );
	const links = [
		{ title: __( 'Domains' ), url: domains },
		{ title: __( 'Backups' ), url: backups },
		{ title: __( 'Manage on WordPress.com' ), url: dashboard },
	].filter( ( link ) => link.url );
	return (
		<FieldSet aria-label={ __( 'Website' ) }>
			<SiteCard
				thumbnailUrl={ getWebsiteThumbnailUrl( website.url ) }
				title={
					<Button
						variant="inline-link"
						size="inline"
						className={ styles.connectedAddressText }
						aria-label={ __( 'Visit site' ) }
						onClick={ () => void connector.openExternalUrl( website.url ) }
					>
						{ websiteAddress( website ) }
					</Button>
				}
				updatedAt={ website.lastPushTimestamp }
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
				<InfoRow title={ __( 'Environment' ) }>{ websiteEnvironmentLabel( website ) }</InfoRow>
				{ website.lastPullTimestamp ? (
					<InfoRow title={ __( 'Last pulled' ) }>
						<RelativeTime timestamp={ website.lastPullTimestamp } active={ open } />
					</InfoRow>
				) : null }
				{ links.map( ( link ) => (
					<Button
						key={ link.title }
						variant="ghost"
						size="default"
						className={ styles.siteLink }
						onClick={ () => void connector.openExternalUrl( link.url! ) }
					>
						{ link.title }
						<ExternalLinkIcon />
					</Button>
				) ) }
			</FieldGroup>
		</FieldSet>
	);
}
