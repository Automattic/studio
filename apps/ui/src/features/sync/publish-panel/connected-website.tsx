import { getSitesDescriptor, type SitesProviderId } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { ChevronDownIcon, EllipsisIcon } from 'lucide-react';
import { useConnector } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { SiteCard, RelativeTime, getWebsiteThumbnailUrl } from '@/features/site-card';
import { DisconnectIcon, DuplicateIcon, ExternalLinkIcon, PlusIcon } from '@/lib/icons';
import {
	Button,
	Field,
	FieldGroup,
	FieldSet,
	FieldTitle,
	IconButton,
	Menu,
	VisuallyHidden,
	Select,
	SelectTrigger,
	SelectContent,
	SelectItem,
	SelectValue,
} from '@/lib/ui';
import styles from './style.module.css';
import type { Website } from './options';
import type { ReactNode, RefObject } from 'react';

function InfoRow( { title, children }: { title: string; children: ReactNode } ) {
	return (
		<Field orientation="horizontal" className={ styles.connectedSiteRow }>
			<FieldTitle>{ title }</FieldTitle>
			<span className={ styles.siteValue }>{ children }</span>
		</Field>
	);
}

// A WordPress.com site still waiting for its launch hasn't been published yet.
function lastPublished( website: Website ) {
	return 'launchAfterPush' in website && website.launchAfterPush ? null : website.lastPushTimestamp;
}

export function ConnectedWebsite( {
	provider,
	website,
	disabled,
	onDisconnect,
	actionsRef,
	switcherRef,
	open,
	websites,
	onSelectWebsite,
	onConnectWebsite,
}: {
	provider: SitesProviderId;
	website: Website;
	disabled: boolean;
	onDisconnect: () => void;
	actionsRef: RefObject< HTMLButtonElement | null >;
	switcherRef: RefObject< HTMLButtonElement | null >;
	open: boolean;
	websites: Website[];
	onSelectWebsite: ( id: Website[ 'id' ] ) => void;
	onConnectWebsite: () => void;
} ) {
	const connector = useConnector();
	const { copied, copy } = useCopyText( website.url );
	const sites = getSitesDescriptor( provider );
	const others = websites.filter( ( remote ) => remote.id !== website.id );
	return (
		<FieldSet aria-label={ __( 'Website' ) }>
			<div className={ styles.destinationCard }>
				<Select
					value={ String( website.id ) }
					onValueChange={ ( value ) => {
						const selected = others.find( ( remote ) => String( remote.id ) === value );
						if ( value === 'connect' ) onConnectWebsite();
						else if ( selected ) onSelectWebsite( selected.id );
					} }
				>
					<SelectTrigger
						ref={ switcherRef }
						variant="unstyled"
						size="icon-sm"
						className={ styles.destinationTrigger }
						disabled={ disabled }
						/* translators: %s: website address */
						aria-label={ sprintf( __( 'Switch website: %s' ), sites.address( website ) ) }
					>
						<SelectValue className={ styles.destinationValue } aria-hidden="true">
							{ '' }
						</SelectValue>
					</SelectTrigger>
					<SelectContent align="start" className={ styles.destinationMenu }>
						{ [ website, ...others ].map( ( remote ) => (
							<SelectItem
								key={ remote.id }
								value={ String( remote.id ) }
								className={ styles.destinationOption }
								label={ sites.address( remote ) }
							>
								<SiteCard
									className={ styles.destinationOptionCard }
									title={ sites.address( remote ) }
									thumbnailUrl={ getWebsiteThumbnailUrl( remote.url ) }
									updatedAt={ lastPublished( remote ) }
									description={ sites.details( remote )[ 0 ]?.value }
									active={ open }
								/>
							</SelectItem>
						) ) }
						<SelectItem value="connect" className={ styles.connectDestination }>
							<PlusIcon aria-hidden="true" />
							{ __( 'Connect another site…' ) }
						</SelectItem>
					</SelectContent>
				</Select>
				<SiteCard
					thumbnailUrl={ getWebsiteThumbnailUrl( website.url ) }
					title={ sites.address( website ) }
					updatedAt={ lastPublished( website ) }
					active={ open }
					description={ __( 'Not published yet' ) }
					actions={
						<div className={ styles.destinationActions }>
							<Menu.Root modal={ false }>
								<Menu.Trigger
									render={
										<IconButton
											ref={ actionsRef }
											className={ styles.destinationAction }
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
							<span className={ styles.destinationChevronSlot } aria-hidden="true">
								<ChevronDownIcon className={ styles.destinationChevron } />
							</span>
						</div>
					}
				/>
			</div>
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
