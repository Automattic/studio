import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { useEffect, useState } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { usePickableWpcomSites } from '@/data/queries/use-wpcom-sites';
import styles from './publish-picker-view.module.css';
import { stripProtocol } from './utils';
import type { SiteDetails, SyncSite } from '@/data/core';

function getLoadErrorDetail( error: unknown ): string {
	// Unwrap Electron's "Error invoking remote method '…':" IPC prefix so the user
	// sees the underlying message, not the transport.
	const message = getErrorMessage( error )
		?.replace( /^Error invoking remote method '[^']+':\s*/i, '' )
		.replace( /^Error:\s*/i, '' )
		.trim();
	if ( ! message ) {
		return __( 'Check your internet connection and try again.' );
	}
	if ( /auth|token|sign[ -]?in|unauthori[sz]ed|\b401\b/i.test( message ) ) {
		return __( 'Your WordPress.com session may have expired.' );
	}
	if ( /network|offline|timed? out|timeout|econn|enotfound|failed to fetch/i.test( message ) ) {
		return __( 'Check your internet connection and try again.' );
	}
	if ( /rate.?limit|too many requests|\b429\b/i.test( message ) ) {
		return __( 'WordPress.com is receiving too many requests. Try again in a moment.' );
	}
	if ( /\b5\d\d\b|service unavailable|bad gateway/i.test( message ) ) {
		return __( 'WordPress.com may be temporarily unavailable. Try again in a moment.' );
	}
	// Only surface the raw message if it's short and not a raw HTTP-request dump;
	// otherwise fall back to the generic hint.
	if ( message.length <= 180 && ! /\b(?:GET|POST) \/.*failed/i.test( message ) ) {
		return message;
	}
	return __( 'Check your internet connection and try again.' );
}

type Props = {
	site: SiteDetails;
	onClose: () => void;
	onLearnMore: () => void;
};

export function PublishPickerView( { site, onClose, onLearnMore }: Props ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const pickableSites = usePickableWpcomSites();
	const sites = pickableSites.data;
	const isLoading = sites === undefined && ( pickableSites.isLoading || pickableSites.isFetching );
	const loadFailed = !! pickableSites.error && pickableSites.data === undefined;
	const [ connectingId, setConnectingId ] = useState< number | null >( null );
	const [ error, setError ] = useState( '' );
	const [ slowLoading, setSlowLoading ] = useState( false );
	const loadErrorDetail = getLoadErrorDetail( pickableSites.error );

	useEffect( () => {
		if ( ! isLoading ) {
			setSlowLoading( false );
			return;
		}
		const timer = window.setTimeout( () => setSlowLoading( true ), 6_000 );
		return () => window.clearTimeout( timer );
	}, [ isLoading ] );

	const handlePickSite = async ( pickedSite: SyncSite ) => {
		if ( connectingId !== null ) {
			return;
		}
		setConnectingId( pickedSite.id );
		setError( '' );
		try {
			// Picking an existing site links it directly, so it's connected without a
			// sync-eligibility check.
			await connector.connectWpcomSite( site.id, {
				...pickedSite,
				localSiteId: site.id,
				syncSupport: 'already-connected',
			} );
			await queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( site.id ),
			} );
			onClose();
		} catch ( caught ) {
			setError(
				caught instanceof Error
					? caught.message
					: __( 'Failed to connect the site. Please try again.' )
			);
		} finally {
			setConnectingId( null );
		}
	};

	const handleCreateNew = () => {
		const checkoutUrl = connector.getPublishCheckoutUrl( site );
		if ( checkoutUrl ) {
			void connector.watchForPublishedSite?.( site.id );
			void connector.openExternalUrl( checkoutUrl );
		}
		onClose();
	};

	return (
		<>
			{ error ? (
				<p role="alert" className={ styles.statusError }>
					{ error }
				</p>
			) : null }
			{ isLoading ? (
				<div role="status" className={ styles.loadingStatus }>
					<span className={ styles.loadingLine }>
						<Spinner className={ styles.spinner } />
						<span>{ __( 'Loading WordPress.com sites…' ) }</span>
					</span>
					{ slowLoading ? (
						<span className={ styles.loadingHint }>
							{ __( 'Large accounts can take a little longer.' ) }
						</span>
					) : null }
				</div>
			) : loadFailed ? (
				<>
					<div role="alert" className={ styles.loadError }>
						<strong>{ __( 'Couldn’t load your WordPress.com sites.' ) }</strong>
						<span>{ loadErrorDetail }</span>
					</div>
					<Menu.Item closeOnClick={ false } onClick={ () => void pickableSites.refetch() }>
						{ __( 'Retry' ) }
					</Menu.Item>
				</>
			) : sites && sites.length > 0 ? (
				<>
					<p className={ styles.sectionLabel }>{ __( 'Available sites' ) }</p>
					<div className={ styles.siteList }>
						<Menu.Group>
							{ sites.map( ( candidate ) => (
								<Menu.Item
									key={ candidate.id }
									className={ styles.siteItem }
									closeOnClick={ false }
									disabled={ connectingId !== null }
									onClick={ () => void handlePickSite( candidate ) }
								>
									<span className={ styles.siteText }>
										<span className={ styles.siteName }>
											{ connectingId === candidate.id
												? __( 'Connecting…' )
												: candidate.name || candidate.url }
										</span>
										<span className={ styles.siteUrl }>{ stripProtocol( candidate.url ) }</span>
									</span>
								</Menu.Item>
							) ) }
						</Menu.Group>
					</div>
				</>
			) : (
				<div className={ styles.emptyState }>
					<strong>{ __( 'Publish to WordPress.com' ) }</strong>
					<span>{ __( 'Create and connect a site for future pushes and pulls.' ) }</span>
				</div>
			) }
			<Menu.Separator />
			<Menu.Item
				className={ styles.createItem }
				disabled={ connectingId !== null }
				onClick={ handleCreateNew }
			>
				<span>{ __( 'Create a site…' ) }</span>
				<Icon className={ styles.menuIcon } icon={ external } size={ 14 } aria-hidden="true" />
			</Menu.Item>
			<Menu.Item onClick={ onLearnMore }>
				<span>{ __( 'Learn more' ) }</span>
			</Menu.Item>
		</>
	);
}
