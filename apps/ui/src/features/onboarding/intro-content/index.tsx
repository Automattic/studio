import { clsx } from 'clsx';
import { StudioIcon, DialogDescription, DialogTitle } from '@/lib/ui';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export interface IntroFeature {
	icon: ReactNode;
	title: string;
	description: string;
}

export function IntroIcon( { className }: { className?: string } ) {
	return <StudioIcon className={ clsx( styles.appIcon, className ) } />;
}

export function IntroHeader( {
	title,
	description,
	showIcon = true,
}: {
	title: string;
	description?: string;
	showIcon?: boolean;
} ) {
	return (
		<div className={ styles.header }>
			{ showIcon && <IntroIcon /> }
			<DialogTitle className={ styles.title }>{ title }</DialogTitle>
			{ description && <DialogDescription>{ description }</DialogDescription> }
		</div>
	);
}

export function IntroFeatures( { features }: { features: IntroFeature[] } ) {
	return (
		<ul className={ styles.features }>
			{ features.map( ( feature ) => (
				<li key={ feature.title } className={ styles.feature }>
					<span className={ styles.featureIcon } aria-hidden="true">
						{ feature.icon }
					</span>
					<div>
						<div className={ styles.featureTitle }>{ feature.title }</div>
						<p className={ styles.featureDescription }>{ feature.description }</p>
					</div>
				</li>
			) ) }
		</ul>
	);
}
