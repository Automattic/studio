import { __, sprintf } from '@wordpress/i18n';
import { ChatIllustration } from './chat';
import { OverviewIllustration } from './overview';
import { PreviewIllustration } from './preview';
import { Stage } from './primitives';
import { SitesIllustration } from './sites';
import styles from './style.module.css';
import { WHATS_NEW_ART } from './whats-new-art';
import type { GuideIllustrationId } from '@/data/onboarding/guide';
import type { ComponentType } from 'react';

// Each orientation page's illustration is a self-contained animated scene
// registered by id. Ids without a scene fall back to the What's New artwork, and
// then to a plain tinted slot, so the guide always renders while the remaining
// scenes are built.
const SCENES: Partial< Record< GuideIllustrationId, ComponentType > > = {
	sites: SitesIllustration,
	chat: ChatIllustration,
	overview: OverviewIllustration,
	preview: PreviewIllustration,
};

// Illustrations with a dark full-bleed background; the modal uses this to flip
// the overlaid close (Skip) button to a light icon so it stays legible.
const DARK_ILLUSTRATIONS: ReadonlySet< GuideIllustrationId > = new Set( [ 'sites' ] );

export function isDarkGuideIllustration( id: GuideIllustrationId ): boolean {
	return DARK_ILLUSTRATIONS.has( id );
}

// The What's New artwork isn't uniformly dark — the dark-mode piece is black on
// one side and white on the other — so a light icon alone can't stay legible
// across all of it. Those pages get a scrim behind the close button instead.
export function needsCloseScrim( id: GuideIllustrationId ): boolean {
	return Boolean( WHATS_NEW_ART[ id ] );
}

function Artwork( { id, title }: { id: GuideIllustrationId; title: string } ) {
	const Scene = SCENES[ id ];
	if ( Scene ) {
		return <Scene />;
	}
	const artwork = WHATS_NEW_ART[ id ];
	if ( artwork ) {
		return (
			<img
				className={ styles.artwork }
				src={ artwork }
				alt={ sprintf(
					/* translators: %s is the title of the guide page the illustration belongs to. */
					__( 'Illustration for %s' ),
					title
				) }
			/>
		);
	}
	return <div className={ styles.placeholder } />;
}

export function GuideIllustration( { id, title }: { id: GuideIllustrationId; title: string } ) {
	return (
		<Stage id={ id }>
			<Artwork id={ id } title={ title } />
		</Stage>
	);
}
