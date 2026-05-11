import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { ChatsTrigger } from '../chats';
import { DeskCreateMenu } from './create-menu';
import styles from './style.module.css';
import { DeskMenu } from './user-menu';
import type { ReactNode } from 'react';

interface DeskHeaderProps {
	children: ReactNode;
}

export function DeskHeader( { children }: DeskHeaderProps ) {
	const isFullscreen = useFullscreen();

	return (
		<div className={ clsx( styles.root, isFullscreen && styles.fullscreen ) }>
			<span className={ styles.title }>{ __( 'Studio' ) }</span>
			<div className={ styles.actions }>{ children }</div>
		</div>
	);
}

interface DeskChromeProps {
	siteId?: string;
}

export function DeskChrome( { siteId }: DeskChromeProps ) {
	return (
		<DeskHeader>
			<DeskMenu siteId={ siteId } />
			<ChatsTrigger />
			<DeskCreateMenu />
		</DeskHeader>
	);
}
