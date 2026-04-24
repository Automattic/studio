import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import { getSiteUrl } from '@/lib/get-site-url';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

interface SitePreviewProps {
	site: SiteDetails;
}

// Isolated iframe + spinner so each URL change fully remounts the loading
// state. The parent-level `useEffect` we tried before missed `load` events
// that fired before React's effect scheduler caught up, leaving the spinner
// stuck.
function PreviewIframe( { src, title }: { src: string; title: string } ) {
	const [ loading, setLoading ] = useState( true );

	// Safety net: some iframes (e.g. blocked by X-Frame-Options in certain
	// WP configs) never fire `load`. Hide the spinner after a few seconds
	// so it doesn't spin forever.
	useEffect( () => {
		const timer = setTimeout( () => setLoading( false ), 8000 );
		return () => clearTimeout( timer );
	}, [] );

	return (
		<>
			<iframe
				className={ styles.iframe }
				src={ src }
				title={ title }
				onLoad={ () => setLoading( false ) }
			/>
			{ loading ? (
				<div className={ styles.spinnerOverlay } aria-hidden="true">
					<span className={ styles.spinner } />
				</div>
			) : null }
		</>
	);
}

export function SitePreview( { site }: SitePreviewProps ) {
	const connector = useConnector();
	const siteUrl = getSiteUrl( site );
	const canPreview = site.running;

	return (
		<aside className={ styles.root } aria-label={ __( 'Site preview' ) }>
			<div className={ styles.header }>
				<div className={ styles.trafficLights } aria-hidden="true">
					<span className={ clsx( styles.trafficLight, styles.trafficLightActive ) } />
					<span className={ styles.trafficLight } />
					<span className={ styles.trafficLight } />
				</div>
				<span className={ styles.headerSpacer } aria-hidden="true" />
				<span className={ styles.separator } aria-hidden="true" />
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ external }
					label={ __( 'Open site in browser' ) }
					disabled={ ! canPreview }
					onClick={ () => void connector.openExternalUrl( siteUrl ) }
				/>
			</div>
			<div className={ styles.body }>
				{ canPreview ? (
					<PreviewIframe key={ siteUrl } src={ siteUrl } title={ site.name } />
				) : (
					<div className={ styles.empty }>{ __( 'Start the site to see a live preview.' ) }</div>
				) }
			</div>
		</aside>
	);
}
