import { __ } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { useActiveTheme } from '@/ui-desks/widgets/theme/use-active-theme';
import styles from './site-url-control.module.css';
import type { ThemeWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';
import type { ComponentProps } from 'react';

type ThemeSiteUrlControlOptions = {
	icon: ComponentProps< typeof Button >[ 'icon' ];
	label: string;
	path: string;
	requiresBlockTheme?: boolean;
};

export function ThemeExploreControl( _props: ControlRenderContext< ThemeWidgetProps > ) {
	return (
		<Button
			className={ styles.toolbarLink }
			label={ __( 'Explore theme' ) }
			variant="quiet"
			size="medium"
			onClick={ () => {
				// Future workspace: full desk for the active theme.
				// Hooked once the destination exists; for now leaves the affordance discoverable.
				console.log( '[StudioDesk] Explore theme \u2014 coming soon' );
			} }
		>
			{ __( 'Explore theme' ) }
		</Button>
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
