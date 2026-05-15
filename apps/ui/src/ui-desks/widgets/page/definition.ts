import { __, sprintf } from '@wordpress/i18n';
import { page } from '@wordpress/icons';
import { getSiteContentMediaDropActions } from '@/ui-desks/widget-actions/drop-handlers/site-content-media-actions';
import { isMediaWidgetProps, MEDIA_WIDGET_TYPE } from '@/ui-desks/widgets/media/types';
import {
	PageWidgetComponent,
	PageWidgetThumbnailComponent,
} from '@/ui-desks/widgets/page/component';
import { PagePreviewControl } from '@/ui-desks/widgets/page/preview-control';
import { isPageWidgetProps, PAGE_WIDGET_TYPE, type PageTone, type PageWidget } from './types';
import type {
	WidgetCustomDropActionContext,
	WidgetCustomDropActionIntent,
	WidgetDefinition,
} from '@/ui-desks/widgets/types';

const PAGE_TONE_COLORS: Record< PageTone, string > = {
	neutral: '#14171a',
	orange: '#e86a00',
	red: '#e5484d',
	violet: '#8703e7',
	blue: '#2200e0',
	sky: '#0081f3',
	green: '#00a96c',
};

const PAGE_TONE_OPTIONS: Array< { value: PageTone; label: string; color: string } > = [
	{ value: 'neutral', label: __( 'Default' ), color: PAGE_TONE_COLORS.neutral },
	{ value: 'orange', label: __( 'Orange' ), color: PAGE_TONE_COLORS.orange },
	{ value: 'red', label: __( 'Red' ), color: PAGE_TONE_COLORS.red },
	{ value: 'violet', label: __( 'Violet' ), color: PAGE_TONE_COLORS.violet },
	{ value: 'blue', label: __( 'Blue' ), color: PAGE_TONE_COLORS.blue },
	{ value: 'sky', label: __( 'Sky' ), color: PAGE_TONE_COLORS.sky },
	{ value: 'green', label: __( 'Green' ), color: PAGE_TONE_COLORS.green },
];

export const pageWidgetDefinition = {
	type: PAGE_WIDGET_TYPE,
	name: () => __( 'Page' ),
	Component: PageWidgetComponent,
	thumbnail: PageWidgetThumbnailComponent,
	controls: [
		{
			type: 'color',
			id: 'tone',
			property: 'tone',
			label: __( 'Color' ),
			options: PAGE_TONE_OPTIONS,
		},
		{
			type: 'custom',
			id: 'preview-page-on-canvas',
			Component: PagePreviewControl,
		},
	],
	isCreatable: false,
	requiresRunningSite: true,
	isWidgetProps: isPageWidgetProps,
	getIndicator: ( widgetProps ) => {
		const color = PAGE_TONE_COLORS[ widgetProps.tone ];
		return {
			cornerRadius: 18,
			stroke: `color-mix(in srgb, ${ color } 50%, white)`,
		};
	},
	labels: {
		add: () => __( 'Add existing page…' ),
		edit: () => __( 'Edit in WP' ),
	},
	icon: page,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 280,
			h: 380,
		},
		widgetProps: {
			pageId: 0,
			tone: 'neutral',
		},
	} ),
	getSummary: ( widgetProps ) =>
		sprintf(
			/* translators: %d: WordPress page ID. */
			__( 'Page #%d' ),
			widgetProps.pageId
		),
	getEditAction: ( { widget, hasSiteId, hasRunningSite } ) =>
		hasSiteId && hasRunningSite && widget.widgetProps.pageId > 0
			? {
					kind: 'site-url',
					path: `/wp-admin/post.php?post=${ widget.widgetProps.pageId }&action=edit`,
			  }
			: null,
	dropHandlers: [
		{
			id: 'media-actions-for-page',
			type: 'custom',
			sourceTypes: [ MEDIA_WIDGET_TYPE ],
			canHandle: ( sourceWidget, targetWidget ) =>
				isMediaWidgetProps( sourceWidget.widgetProps ) &&
				sourceWidget.widgetProps.mediaId !== null &&
				isPageWidgetProps( targetWidget.widgetProps ) &&
				targetWidget.widgetProps.pageId > 0,
			getActions: getPageMediaDropActions,
		},
	],
} satisfies WidgetDefinition< PageWidget >;

function getPageMediaDropActions(
	intent: WidgetCustomDropActionIntent,
	context: WidgetCustomDropActionContext
) {
	const mediaProps = intent.sourceWidget.widgetProps;
	const pageProps = intent.targetWidget.widgetProps;
	if (
		! isMediaWidgetProps( mediaProps ) ||
		mediaProps.mediaId === null ||
		! isPageWidgetProps( pageProps )
	) {
		return [];
	}

	return getSiteContentMediaDropActions( {
		kind: 'page',
		contentId: pageProps.pageId,
		attachLabel: __( 'Attach to page' ),
		media: {
			id: mediaProps.mediaId,
			url: mediaProps.url,
			alt: mediaProps.alt,
			kind: mediaProps.mediaKind,
		},
		context,
	} );
}
