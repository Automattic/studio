import { __ } from '@wordpress/i18n';
import { chevronDownSmall, external } from '@wordpress/icons';
import { Button, Icon, IconButton } from '@wordpress/ui';
import { forwardRef, useMemo } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import styles from './style.module.css';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';
import type { ComponentProps, ElementRef } from 'react';

function stripProtocol( url: string ): string {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

type TriggerProps = Omit< ComponentProps< 'button' >, 'children' > & {
	siteName: string;
};

const DropdownTrigger = forwardRef< ElementRef< 'button' >, TriggerProps >(
	function DropdownTrigger( { siteName, className, ...props }, ref ) {
		return (
			<button
				ref={ ref }
				type="button"
				className={ `${ styles.trigger } ${ className ?? '' }` }
				{ ...props }
			>
				<span className={ styles.triggerSite }>{ siteName }</span>
				<span className={ styles.triggerDot } aria-hidden="true" />
				<span className={ styles.triggerEnv }>{ __( 'Local' ) }</span>
				<Icon icon={ chevronDownSmall } size={ 18 } />
			</button>
		);
	}
);

function PopoverRow( {
	label,
	sublabel,
	action,
}: {
	label: React.ReactNode;
	sublabel?: React.ReactNode;
	action?: React.ReactNode;
} ) {
	return (
		<div className={ styles.row }>
			<div className={ styles.rowText }>
				<div className={ styles.rowLabel }>{ label }</div>
				{ sublabel ? <div className={ styles.rowSublabel }>{ sublabel }</div> : null }
			</div>
			{ action ? <div className={ styles.rowAction }>{ action }</div> : null }
		</div>
	);
}

type Props = {
	site: SiteDetails;
};

function ensureProtocol( url: string ): string {
	return /^https?:\/\//.test( url ) ? url : `https://${ url }`;
}

function pickLiveSite( connectedSites: SyncSite[] | undefined ): SyncSite | undefined {
	if ( ! connectedSites || connectedSites.length === 0 ) {
		return undefined;
	}
	// Prefer the production (non-staging) site; fall back to anything connected
	// so a staging-only link is still surfaced rather than silently dropped.
	return connectedSites.find( ( site ) => ! site.isStaging ) ?? connectedSites[ 0 ];
}

function pickLatestSnapshot(
	snapshots: Snapshot[] | undefined,
	siteId: string
): Snapshot | undefined {
	if ( ! snapshots ) {
		return undefined;
	}
	// `date` is a unix timestamp; the most recent snapshot wins.
	return snapshots
		.filter( ( snapshot ) => snapshot.localSiteId === siteId )
		.reduce< Snapshot | undefined >( ( latest, candidate ) => {
			if ( ! latest || candidate.date > latest.date ) {
				return candidate;
			}
			return latest;
		}, undefined );
}

export function SiteDropdown( { site }: Props ) {
	const connector = useConnector();
	const localUrl = site.url;
	const { data: snapshots } = useSnapshots();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger render={ <DropdownTrigger siteName={ site.name } /> } />
			<Menu.Popup side="bottom" align="start" className={ styles.popup }>
				<div className={ styles.rows }>
					<PopoverRow
						label={ __( 'Local site' ) }
						sublabel={ localUrl ? stripProtocol( localUrl ) : __( 'Not running' ) }
						action={
							localUrl ? (
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ external }
									label={ __( 'Open local site' ) }
									onClick={ () => openExternal( localUrl ) }
								/>
							) : null
						}
					/>

					<PopoverRow
						label={ __( 'Live site' ) }
						sublabel={ liveSite ? stripProtocol( liveSite.url ) : __( 'Not yet published' ) }
						action={
							liveSite ? (
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ external }
									label={ __( 'Open live site' ) }
									onClick={ () => openExternal( ensureProtocol( liveSite.url ) ) }
								/>
							) : (
								<span className={ styles.emDash }>—</span>
							)
						}
					/>

					{ previewSnapshot ? (
						<PopoverRow
							label={ __( 'Preview site' ) }
							sublabel={ stripProtocol( previewSnapshot.url ) }
							action={
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ external }
									label={ __( 'Open preview site' ) }
									onClick={ () => openExternal( ensureProtocol( previewSnapshot.url ) ) }
								/>
							}
						/>
					) : null }
				</div>

				<div className={ styles.footer }>
					<Button variant="outline" tone="neutral" size="compact" className={ styles.footerButton }>
						{ __( 'Preview' ) }
					</Button>
					<Button variant="solid" tone="brand" size="compact" className={ styles.footerButton }>
						{ __( 'Publish…' ) }
					</Button>
				</div>
			</Menu.Popup>
		</Menu.Root>
	);
}
