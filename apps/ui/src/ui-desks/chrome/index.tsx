import { clsx } from 'clsx';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { DeskChatsButton } from './chats-button';
import { DeskCreateMenu } from './create-menu';
import styles from './style.module.css';
import { DeskUserMenu } from './user-menu';

interface DeskChromeProps {
	chatsOpen: boolean;
	onToggleChats: () => void;
}

export function DeskChrome( { chatsOpen, onToggleChats }: DeskChromeProps ) {
	const isFullscreen = useFullscreen();

	return (
		<div className={ clsx( styles.root, isFullscreen && styles.fullscreen ) }>
			<DeskUserMenu />
			<DeskChatsButton open={ chatsOpen } onToggle={ onToggleChats } />
			<DeskCreateMenu />
		</div>
	);
}
