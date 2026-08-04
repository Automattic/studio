import { ChatIllustration } from './chat';
import { Stage } from './primitives';
import { SitesIllustration } from './sites';
import styles from './style.module.css';
import type { OrientationIllustrationId } from '@/data/onboarding/orientation-guide';
import type { ComponentType } from 'react';

// Each page's illustration is a self-contained animated scene registered by id.
// Ids without a scene yet fall back to a plain tinted slot, so the guide always
// renders while the remaining scenes are built.
const SCENES: Partial< Record< OrientationIllustrationId, ComponentType > > = {
	sites: SitesIllustration,
	chat: ChatIllustration,
};

// Illustrations with a dark full-bleed background; the modal uses this to flip
// the overlaid close (Skip) button to a light icon so it stays legible.
const DARK_ILLUSTRATIONS: ReadonlySet< OrientationIllustrationId > = new Set( [ 'sites' ] );

export function isDarkOrientationIllustration( id: OrientationIllustrationId ): boolean {
	return DARK_ILLUSTRATIONS.has( id );
}

export function OrientationIllustration( { id }: { id: OrientationIllustrationId } ) {
	const Scene = SCENES[ id ];
	return <Stage id={ id }>{ Scene ? <Scene /> : <div className={ styles.placeholder } /> }</Stage>;
}
