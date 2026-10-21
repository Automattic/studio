import { SessionView, SignedOutSessionView } from '@/components/session-view';
import styles from './style.module.css';

export function SiteWorkspace( { siteId, sessionId }: { siteId: string; sessionId?: string } ) {
	return (
		<div className={ styles.root }>
			<div className={ styles.layer }>
				{ sessionId ? (
					<SessionView key={ sessionId } sessionId={ sessionId } />
				) : (
					<SignedOutSessionView siteId={ siteId } />
				) }
			</div>
		</div>
	);
}
