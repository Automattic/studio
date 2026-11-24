import { Spinner } from '@studio/ds';
import { __ } from '@wordpress/i18n';
import { useSiteSyncActivity } from '@/data/sync-activity';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function useShareStatus( siteId: string ) {
	const activity = useSiteSyncActivity( siteId );
	const publishing = activity?.kind === 'pending' && activity.direction === 'preview';
	let label: string | undefined;
	if ( publishing ) {
		label = activity.hostname ? __( 'Updating preview…' ) : __( 'Creating preview…' );
	}
	return { publishing, label };
}

export function ShareStatusIcon( {
	icon,
	status,
}: {
	icon: ReactNode;
	status: ReturnType< typeof useShareStatus >;
} ) {
	return <span className={ styles.statusIcon }>{ status.publishing ? <Spinner /> : icon }</span>;
}
