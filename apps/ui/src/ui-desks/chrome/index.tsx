import { __, _n, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { DeskChatsTrigger } from '../chats';
import { DeskCreateMenu } from './create-menu';
import { DeskSiteMapButton } from './site-map-button';
import styles from './style.module.css';
import { DeskMenu } from './user-menu';
import type { ReactNode } from 'react';

interface DeskHeaderProps {
	children: ReactNode;
	centerChildren?: ReactNode;
	rightChildren?: ReactNode;
}

export function DeskHeader( { children, centerChildren, rightChildren }: DeskHeaderProps ) {
	const isFullscreen = useFullscreen();

	return (
		<div className={ clsx( styles.root, isFullscreen && styles.fullscreen ) }>
			<span className={ styles.title }>{ __( 'Studio' ) }</span>
			<div className={ styles.actions }>{ children }</div>
			{ centerChildren && <div className={ styles.centerActions }>{ centerChildren }</div> }
			{ rightChildren && <div className={ styles.rightActions }>{ rightChildren }</div> }
		</div>
	);
}

interface DeskChromeProps {
	siteId?: string;
	siteMapOpen?: boolean;
	siteMapPageCount?: number;
	onToggleSiteMap?: () => void;
}

export function DeskChrome( {
	siteId,
	siteMapOpen = false,
	siteMapPageCount,
	onToggleSiteMap,
}: DeskChromeProps ) {
	return (
		<DeskHeader
			centerChildren={ siteMapOpen ? <DeskSiteMapTitle pageCount={ siteMapPageCount } /> : null }
			rightChildren={
				siteId && onToggleSiteMap ? (
					<DeskSiteMapButton siteId={ siteId } open={ siteMapOpen } onToggle={ onToggleSiteMap } />
				) : null
			}
		>
			<DeskMenu siteId={ siteId } />
			<DeskChatsTrigger />
			<DeskCreateMenu />
		</DeskHeader>
	);
}

function DeskSiteMapTitle( { pageCount }: { pageCount?: number } ) {
	return (
		<div className={ styles.siteMapTitle }>
			<h1>{ __( 'Site map' ) }</h1>
			{ pageCount !== undefined && (
				<span>{ sprintf( _n( '%d page', '%d pages', pageCount ), pageCount ) }</span>
			) }
		</div>
	);
}
