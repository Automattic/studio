import { __ } from '@wordpress/i18n';
import { DeskChats } from '../chats';
import { DeskChrome } from '../chrome';
import { DeskCanvas } from './canvas';
import { DeskProvider } from './provider';
import styles from './style.module.css';
import type { ReactNode } from 'react';

interface DeskProps {
	siteId?: string;
}

export function Desk( { siteId }: DeskProps ) {
	return (
		<DeskProvider key={ siteId ?? 'user' } siteId={ siteId }>
			<DeskShell siteId={ siteId }>
				<DeskCanvas />
			</DeskShell>
		</DeskProvider>
	);
}

function DeskShell( { siteId, children }: DeskProps & { children: ReactNode } ) {
	return (
		<>
			<DeskChats siteId={ siteId } />
			<main className={ styles.root } aria-label={ getDeskLabel( siteId ) } data-site-id={ siteId }>
				<DeskChrome siteId={ siteId } />
				{ children }
			</main>
		</>
	);
}

function getDeskLabel( siteId?: string ) {
	return siteId ? __( 'Site desk' ) : __( 'User desk' );
}
