import { __, _n, sprintf } from '@wordpress/i18n';
import styles from './style.module.css';

export function DeskSiteMapTitle( { pageCount }: { pageCount?: number } ) {
	return (
		<div className={ styles.siteMapTitle }>
			<h1>{ __( 'Site map' ) }</h1>
			{ pageCount !== undefined && (
				<span>{ sprintf( _n( '%d page', '%d pages', pageCount ), pageCount ) }</span>
			) }
		</div>
	);
}
