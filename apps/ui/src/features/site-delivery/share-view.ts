import { __ } from '@wordpress/i18n';
import type { PublishTarget } from './use-publish-targets';
import type { SitesProviderId } from '@studio/providers';

type ChooserView = { kind: 'chooser'; focusKey?: string; unavailableTarget?: boolean };
type DetailsView = {
	kind: 'details';
	targetKey: string;
	previewSiteId?: number;
	returnTo?: ShareDestinationView;
};
type ShareDestinationView = ChooserView | DetailsView;

type SetupView = { kind: 'setup'; returnTo?: ShareDestinationView };
type ShareContentView = ShareDestinationView | SetupView;

export type ShareView =
	| ShareContentView
	| { kind: 'entry'; target?: { provider?: SitesProviderId; remoteSiteId: string | number } }
	| { kind: 'existing'; returnTo: SetupView };

export function getShareViewTitle( view: ShareView, selected?: PublishTarget ): string {
	switch ( view.kind ) {
		case 'entry':
			return __( 'Publish' );
		case 'setup':
			return view.returnTo ? __( 'Publish somewhere else' ) : __( 'Publish' );
		case 'chooser':
			return __( 'Choose a site' );
		case 'details':
			return selected?.snapshot || ( ! selected && view.previewSiteId !== undefined )
				? __( 'Preview details' )
				: __( 'Publish' );
		case 'existing':
			return __( 'Choose an existing site' );
	}
}

export function shareEntryView( targets: PublishTarget[], unavailable: boolean ): ShareContentView {
	if ( unavailable || targets.length > 1 ) return { kind: 'chooser' };
	if ( targets.length === 1 )
		return {
			kind: 'details',
			targetKey: targets[ 0 ].key,
			previewSiteId: targets[ 0 ].snapshot?.atomicSiteId,
		};
	return { kind: 'setup' };
}
