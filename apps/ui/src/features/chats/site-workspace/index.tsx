import { SessionView } from '@/features/chats/session-view';
import styles from './style.module.css';

export function SiteWorkspace( { sessionId }: { sessionId?: string } ) {
	return (
		<div className={ styles.root }>
			<div className={ styles.layer }>
				{ sessionId ? <SessionView key={ sessionId } sessionId={ sessionId } /> : null }
			</div>
		</div>
	);
}
