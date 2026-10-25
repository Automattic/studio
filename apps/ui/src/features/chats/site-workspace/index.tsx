import { SessionView } from '@/features/chats/session-view';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function SiteWorkspace( {
	sessionId,
	headerStart,
}: {
	sessionId?: string;
	headerStart?: ReactNode;
} ) {
	return (
		<div className={ styles.root }>
			<div className={ styles.layer }>
				{ sessionId ? (
					<SessionView key={ sessionId } sessionId={ sessionId } headerStart={ headerStart } />
				) : null }
			</div>
		</div>
	);
}
