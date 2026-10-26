import { ChatIllustration } from './chat';
import { PreviewIllustration } from './preview';
import { Stage } from './primitives';
import { SitesIllustration } from './sites';
import {
	AppearanceIllustration,
	CommandPaletteIllustration,
	PublishShareIllustration,
	StudioCodeIllustration,
	WorkspaceIllustration,
} from './whats-new';
import type { GuideIllustrationId } from '@/features/onboarding/onboarding-guide/guide';
import type { ComponentType } from 'react';

// Each page's illustration is a self-contained scene registered by id.
const SCENES: Record< GuideIllustrationId, ComponentType > = {
	sites: SitesIllustration,
	chat: ChatIllustration,
	preview: PreviewIllustration,
	workspace: WorkspaceIllustration,
	'studio-code': StudioCodeIllustration,
	'publish-share': PublishShareIllustration,
	'command-palette': CommandPaletteIllustration,
	appearance: AppearanceIllustration,
};

// Illustrations with a dark full-bleed background; the modal uses this to flip
// the overlaid close (Skip) button to a light icon so it stays legible.
const DARK_ILLUSTRATIONS: ReadonlySet< GuideIllustrationId > = new Set( [ 'sites' ] );

export function isDarkGuideIllustration( id: GuideIllustrationId ): boolean {
	return DARK_ILLUSTRATIONS.has( id );
}

export function GuideIllustration( { id }: { id: GuideIllustrationId } ) {
	const Scene = SCENES[ id ];
	return (
		<Stage>
			<Scene />
		</Stage>
	);
}
