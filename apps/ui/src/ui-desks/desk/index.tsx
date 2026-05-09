import { __ } from '@wordpress/i18n';
import { useEffect, useMemo } from 'react';
import { useDeskConfig, useSaveDeskConfig } from '@/data/queries/use-desk-config';
import { DeskChats } from '../chats';
import { DeskChrome } from '../chrome';
import { DeskActionsProvider } from './actions-context';
import { DeskCanvas as TldrawDeskCanvas } from './canvas';
import { defaultUserDesk } from './default-desk';
import styles from './style.module.css';
import { DESK_CONFIG_VERSION, type DeskConfig } from './types';

interface DeskProps {
	siteId?: string;
}

export function Desk( { siteId }: DeskProps ) {
	const canvasKey = siteId ?? 'user';

	return (
		<DeskActionsProvider>
			<DeskChats siteId={ siteId } />
			<main className={ styles.root } aria-label={ getDeskLabel( siteId ) } data-site-id={ siteId }>
				<DeskChrome activeSiteId={ siteId } />
				<DeskCanvas key={ canvasKey } siteId={ siteId } />
			</main>
		</DeskActionsProvider>
	);
}

function DeskCanvas( { siteId }: DeskProps ) {
	const { data: savedDesk, isLoading } = useDeskConfig( siteId );
	const { mutate: saveDeskConfig } = useSaveDeskConfig( siteId );
	const defaultDesk = useMemo( () => createDefaultDeskConfig( siteId ), [ siteId ] );
	const desk = ( savedDesk as DeskConfig | undefined ) ?? defaultDesk;

	useEffect( () => {
		if ( ! isLoading && ! savedDesk ) {
			saveDeskConfig( defaultDesk );
		}
	}, [ defaultDesk, isLoading, savedDesk, saveDeskConfig ] );

	if ( isLoading ) {
		return <div className={ styles.loading } />;
	}

	return <TldrawDeskCanvas desk={ desk } onChange={ saveDeskConfig } />;
}

function createDefaultDeskConfig( siteId?: string ): DeskConfig {
	if ( siteId ) {
		return {
			version: DESK_CONFIG_VERSION,
			updatedAt: new Date().toISOString(),
			widgets: [],
		};
	}

	return defaultUserDesk;
}

function getDeskLabel( siteId?: string ) {
	return siteId ? __( 'Site desk' ) : __( 'User desk' );
}
