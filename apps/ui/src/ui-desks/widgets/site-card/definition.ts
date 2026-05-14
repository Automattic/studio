import { __ } from '@wordpress/i18n';
import { globe } from '@wordpress/icons';
import {
	SiteCardWidgetComponent,
	SiteCardWidgetThumbnailComponent,
} from '@/ui-desks/widgets/site-card/component';
import {
	SiteCardEditCancelControl,
	SiteCardEditSaveControl,
} from '@/ui-desks/widgets/site-card/edit-controls';
import { SiteCardPreviewControl } from '@/ui-desks/widgets/site-card/preview-control';
import { isSiteCardWidgetProps, SITE_CARD_WIDGET_TYPE, type SiteCardWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const siteCardWidgetDefinition = {
	type: SITE_CARD_WIDGET_TYPE,
	name: () => __( 'Site card' ),
	Component: SiteCardWidgetComponent,
	thumbnail: SiteCardWidgetThumbnailComponent,
	controls: [
		{
			type: 'custom',
			id: 'site-card-preview',
			Component: SiteCardPreviewControl,
		},
	],
	isCreatable: false,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isSiteCardWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: '#3858e9',
	} ),
	labels: {
		add: () => __( 'New site card' ),
		edit: () => __( 'Edit site identity' ),
	},
	icon: globe,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 360,
			h: 200,
		},
		widgetProps: {
			previewVisible: false,
		},
	} ),
	getSummary: () => __( 'Site card' ),
	getEditAction: () => ( { kind: 'focus-mode' } ),
	focusModeControls: [
		{
			type: 'custom',
			id: 'cancel-site-card-edit',
			Component: SiteCardEditCancelControl,
		},
		{
			type: 'custom',
			id: 'save-site-card-edit',
			Component: SiteCardEditSaveControl,
		},
	],
	focusModeControlsLabel: () => __( 'Edit site identity actions' ),
} satisfies WidgetDefinition< SiteCardWidget >;
