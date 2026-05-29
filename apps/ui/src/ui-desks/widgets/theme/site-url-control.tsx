import { type ComponentProps } from 'react';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { useActiveTheme } from '@/ui-desks/widgets/theme/use-active-theme';
import { type ThemeWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

type ThemeSiteUrlControlOptions = {
	icon: ComponentProps< typeof Button >[ 'icon' ];
	label: string;
	path: string;
	requiresBlockTheme?: boolean;
};

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
