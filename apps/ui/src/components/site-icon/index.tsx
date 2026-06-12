import { clsx } from 'clsx';
import { useState } from 'react';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef, CSSProperties } from 'react';

type SiteIconStyle = CSSProperties & {
	'--site-icon-color-a': string;
	'--site-icon-color-b': string;
	'--site-icon-color-c': string;
	'--site-icon-color-d': string;
	'--site-icon-position-a': string;
	'--site-icon-position-b': string;
	'--site-icon-position-c': string;
};

type Props = ComponentPropsWithoutRef< 'span' > & {
	seed?: string;
	// Data URL for the configured WordPress Site Icon. Falls back to the
	// procedural mesh gradient when missing or when the image fails to load.
	imageSrc?: string | null;
};

function hashSeed( seed: string ): number {
	let hash = 0;
	for ( let index = 0; index < seed.length; index++ ) {
		hash = ( hash << 5 ) - hash + seed.charCodeAt( index );
		hash |= 0;
	}
	return Math.abs( hash );
}

function getMeshGradientStyle( seed = 'site' ): SiteIconStyle {
	const hash = hashSeed( seed );
	const hue = hash % 360;
	const offset = ( hash >> 4 ) % 48;

	return {
		'--site-icon-color-a': `hsl(${ hue } 88% 58%)`,
		'--site-icon-color-b': `hsl(${ ( hue + 92 + offset ) % 360 } 84% 62%)`,
		'--site-icon-color-c': `hsl(${ ( hue + 188 + offset ) % 360 } 82% 54%)`,
		'--site-icon-color-d': `hsl(${ ( hue + 276 + offset ) % 360 } 86% 66%)`,
		'--site-icon-position-a': `${ 18 + ( hash % 34 ) }% ${ 20 + ( ( hash >> 3 ) % 30 ) }%`,
		'--site-icon-position-b': `${ 58 + ( ( hash >> 6 ) % 28 ) }% ${ 16 + ( ( hash >> 9 ) % 36 ) }%`,
		'--site-icon-position-c': `${ 30 + ( ( hash >> 12 ) % 40 ) }% ${
			58 + ( ( hash >> 15 ) % 28 )
		}%`,
	};
}

export function SiteIcon( { className, seed, style, imageSrc, ...props }: Props ) {
	const [ hasImageError, setHasImageError ] = useState( false );
	const showImage = !! imageSrc && ! hasImageError;

	return (
		<span
			{ ...props }
			className={ clsx( styles.root, showImage && styles.rootWithImage, className ) }
			style={ showImage ? style : { ...getMeshGradientStyle( seed ), ...style } }
			aria-hidden="true"
		>
			{ showImage && (
				<img
					className={ styles.image }
					src={ imageSrc as string }
					alt=""
					onError={ () => setHasImageError( true ) }
				/>
			) }
		</span>
	);
}
