import { __ } from '@wordpress/i18n';
import styles from './cards.module.css';
import { CardSection } from './overview-card';
import type { SiteDetails } from '@/data/core';

export function AboutSection( { site, wpVersion }: { site: SiteDetails; wpVersion?: string } ) {
	const themeName = site.themeDetails?.name || site.themeDetails?.slug || '—';

	return (
		<CardSection>
			<div className={ styles.tiles }>
				<Tile label={ __( 'Theme' ) } value={ themeName } />
				<Tile label={ __( 'WordPress' ) } value={ wpVersion || '—' } />
				<Tile label={ __( 'PHP' ) } value={ site.phpVersion } />
			</div>
		</CardSection>
	);
}

function Tile( { label, value }: { label: string; value: string } ) {
	return (
		<div className={ styles.tile }>
			<span className={ styles.tileLabel }>{ label }</span>
			<span className={ styles.tileValue } title={ value }>
				{ value }
			</span>
		</div>
	);
}
