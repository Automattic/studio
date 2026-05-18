import { useRegistry } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { useState, type ComponentProps } from 'react';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { getThemePatterns, getThemeTemplates } from '@/ui-desks/widgets/theme/api';
import { useActiveTheme } from '@/ui-desks/widgets/theme/use-active-theme';
import {
	createThemePatternBrowserTemporaryDesk,
	getThemePatternBrowserTemporaryDeskId,
} from '@/ui-desks/widgets/theme-pattern-browser/definition';
import {
	THEME_PATTERN_BROWSER_WIDGET_TYPE,
	type ThemePatternBrowserWidget,
} from '@/ui-desks/widgets/theme-pattern-browser/types';
import {
	createThemeTemplateBrowserTemporaryDesk,
	getThemeTemplateBrowserTemporaryDeskId,
} from '@/ui-desks/widgets/theme-template-browser/definition';
import {
	THEME_TEMPLATE_BROWSER_WIDGET_TYPE,
	type ThemeTemplateBrowserWidget,
} from '@/ui-desks/widgets/theme-template-browser/types';
import styles from './site-url-control.module.css';
import { isThemeWidgetProps, THEME_WIDGET_TYPE, type ThemeWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

type ThemeSiteUrlControlOptions = {
	icon: ComponentProps< typeof Button >[ 'icon' ];
	label: string;
	path: string;
	requiresBlockTheme?: boolean;
};

export function ThemeExploreControl( _props: ControlRenderContext< ThemeWidgetProps > ) {
	const desk = useDesk();
	const registry = useRegistry();
	const [ isLoading, setIsLoading ] = useState( false );
	const sourceWidget = getSelectedThemeWidget( desk.selectedWidgetToolbarItem );
	const canExplore = Boolean( sourceWidget && desk.canAddWidgets && desk.siteId );
	const browserSources = sourceWidget ? getThemeExploreBrowserSources( sourceWidget ) : null;
	const patternTemporaryDeskId = browserSources
		? getThemePatternBrowserTemporaryDeskId( browserSources.pattern.id )
		: null;
	const templateTemporaryDeskId = browserSources
		? getThemeTemplateBrowserTemporaryDeskId( browserSources.template.id )
		: null;
	const isActive = Boolean(
		( patternTemporaryDeskId && desk.isTemporaryDeskVisible( patternTemporaryDeskId ) ) ||
			( templateTemporaryDeskId && desk.isTemporaryDeskVisible( templateTemporaryDeskId ) )
	);

	return (
		<Button
			className={ styles.toolbarLink }
			label={ __( 'Explore theme' ) }
			variant="quiet"
			size="medium"
			aria-pressed={ isActive }
			disabled={ ! canExplore || isLoading }
			onClick={ async () => {
				if ( ! sourceWidget || ! browserSources ) {
					return;
				}

				if ( isActive ) {
					closeThemeExploreTemporaryDesks( desk, browserSources );
					return;
				}

				setIsLoading( true );
				try {
					const [ templates, patterns ] = await Promise.all( [
						getThemeTemplates( { registry } ),
						getThemePatterns( { registry } ),
					] );
					const templateDesk = createThemeTemplateBrowserTemporaryDesk(
						browserSources.template,
						templates
					);
					const patternDesk = createThemePatternBrowserTemporaryDesk(
						browserSources.pattern,
						patterns
					);

					for ( const temporaryDesk of [ templateDesk, patternDesk ] ) {
						if ( temporaryDesk ) {
							desk.toggleTemporaryDesk( {
								...temporaryDesk,
								sourceWidgetId: sourceWidget.id,
								followSource: true,
							} );
						}
					}
				} finally {
					setIsLoading( false );
				}
			} }
		>
			{ __( 'Explore theme' ) }
		</Button>
	);
}

function getSelectedThemeWidget(
	selectedWidgetToolbarItem: ReturnType< typeof useDesk >[ 'selectedWidgetToolbarItem' ]
) {
	const widget =
		selectedWidgetToolbarItem?.kind === 'single-widget' ? selectedWidgetToolbarItem.widget : null;
	if (
		widget?.type !== THEME_WIDGET_TYPE ||
		! isThemeWidgetProps( widget.widgetProps ) ||
		! isThemeShapeProps( widget.shapeProps )
	) {
		return null;
	}

	return widget as DeskWidget & {
		shapeProps: {
			w: number;
			h: number;
		};
	};
}

function getThemeExploreBrowserSources(
	sourceWidget: DeskWidget & {
		shapeProps: {
			w: number;
			h: number;
		};
	}
) {
	const gap = 96;
	const templateTopLeft = {
		x: sourceWidget.x + sourceWidget.shapeProps.w + gap,
		y: sourceWidget.y,
	};
	const patternTopLeft = {
		x: sourceWidget.x,
		y: sourceWidget.y + sourceWidget.shapeProps.h + gap,
	};

	return {
		template: {
			id: `${ sourceWidget.id }:template-browser`,
			type: THEME_TEMPLATE_BROWSER_WIDGET_TYPE,
			x: templateTopLeft.x,
			y: templateTopLeft.y,
			zIndex: sourceWidget.zIndex,
			shapeProps: {
				w: 1,
				h: 1,
			},
			widgetProps: {},
		} satisfies ThemeTemplateBrowserWidget,
		pattern: {
			id: `${ sourceWidget.id }:pattern-browser`,
			type: THEME_PATTERN_BROWSER_WIDGET_TYPE,
			x: patternTopLeft.x,
			y: patternTopLeft.y,
			zIndex: sourceWidget.zIndex,
			shapeProps: {
				w: 1,
				h: 1,
			},
			widgetProps: {
				limit: 10,
				viewMode: 'tiles',
			},
		} satisfies ThemePatternBrowserWidget,
	};
}

function closeThemeExploreTemporaryDesks(
	desk: ReturnType< typeof useDesk >,
	browserSources: ReturnType< typeof getThemeExploreBrowserSources >
) {
	const templateDeskId = getThemeTemplateBrowserTemporaryDeskId( browserSources.template.id );
	const patternDeskId = getThemePatternBrowserTemporaryDeskId( browserSources.pattern.id );

	if ( desk.isTemporaryDeskVisible( templateDeskId ) ) {
		desk.toggleTemporaryDesk( { id: templateDeskId, widgets: [] } );
	}
	if ( desk.isTemporaryDeskVisible( patternDeskId ) ) {
		desk.toggleTemporaryDesk( { id: patternDeskId, widgets: [] } );
	}
}

function isThemeShapeProps( value: unknown ): value is { w: number; h: number } {
	const candidate = value as { w?: unknown; h?: unknown };
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof candidate.w === 'number' &&
		typeof candidate.h === 'number'
	);
}

export function ThemeSiteUrlControl( {
	icon,
	path,
	label,
	requiresBlockTheme = false,
}: ThemeSiteUrlControlOptions ) {
	return function ThemeSiteUrlControlComponent( _props: ControlRenderContext< ThemeWidgetProps > ) {
		const connector = useConnector();
		const { siteId } = useDesk();
		const { data: sites } = useSites();
		const site = sites?.find( ( candidateSite ) => candidateSite.id === siteId );
		const isBlockTheme = site?.themeDetails?.isBlockTheme;
		const activeTheme = useActiveTheme(
			requiresBlockTheme && Boolean( siteId ) && isBlockTheme === undefined
		);

		if ( requiresBlockTheme && isBlockTheme !== true && activeTheme?.isBlockTheme !== true ) {
			return null;
		}

		return (
			<Button
				icon={ icon }
				label={ label }
				variant="quiet"
				size="medium"
				disabled={ ! siteId }
				onClick={ () => {
					if ( siteId ) {
						void connector.openSiteUrl( siteId, path );
					}
				} }
			/>
		);
	};
}
