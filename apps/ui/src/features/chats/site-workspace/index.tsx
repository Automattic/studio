import { SessionView } from '@/features/chats/session-view';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function SiteWorkspace( {
	sessionId,
	siteId,
	headerStart,
	hideHeader,
	panelVisible,
}: {
	sessionId?: string;
	siteId: string;
	headerStart?: ReactNode;
	hideHeader?: boolean;
	panelVisible?: boolean;
} ) {
	return (
		<div className={ styles.root }>
			<div className={ styles.layer }>
				<SessionView
					key={ sessionId ?? siteId }
					sessionId={ sessionId }
					siteId={ siteId }
					headerStart={ headerStart }
					hideHeader={ hideHeader }
					panelVisible={ panelVisible }
				/>
			</div>
		</div>
	);
}
