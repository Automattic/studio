import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import {
	SiteShortcutsWidgetComponent,
	SiteShortcutsWidgetThumbnailComponent,
} from '@/ui-desks/widgets/site-shortcuts/component';
import {
	isSiteShortcutsWidgetProps,
	SITE_SHORTCUTS_WIDGET_TYPE,
	type SiteShortcutsWidget,
} from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const siteShortcutsWidgetDefinition = {
	type: SITE_SHORTCUTS_WIDGET_TYPE,
	name: () => __( 'Site shortcuts' ),
	Component: SiteShortcutsWidgetComponent,
	thumbnail: SiteShortcutsWidgetThumbnailComponent,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isSiteShortcutsWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: '#3858e9',
	} ),
	labels: {
		add: () => __( 'New site shortcuts' ),
	},
	icon: external,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 400,
			h: 500,
		},
		widgetProps: {},
	} ),
	getSummary: () => __( 'Site shortcuts' ),
	resizeConstraints: {
		minWidth: 340,
		minHeight: 360,
	},
} satisfies WidgetDefinition< SiteShortcutsWidget >;
