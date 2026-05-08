import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { DeskChatsButton } from './chats-button';
import { DeskCreateMenu } from './create-menu';
import styles from './style.module.css';
import { DeskMenu } from './user-menu';
import type { ReactNode } from 'react';

interface DeskChromeProps {
	chatsOpen: boolean;
	onToggleChats: () => void;
}

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

export function DeskChrome( { chatsOpen, onToggleChats }: DeskChromeProps ) {
	return (
		<DeskHeader>
			<DeskMenu />
			<DeskChatsButton open={ chatsOpen } onToggle={ onToggleChats } />
			<DeskCreateMenu />
		</DeskHeader>
	);
}
