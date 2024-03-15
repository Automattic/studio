import { __ } from '@wordpress/i18n';
import { archive, desktop, layout, navigation, page, styles, symbolFilled } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useThemeDetails } from '../hooks/use-theme-details';
import { isMac } from '../lib/app-globals';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { ButtonsSection, ButtonsSectionProps } from './buttons-section';

interface ContentTabOverviewProps {
	selectedSite: SiteDetails;
}

function CustomizeSection( {
	selectedSite,
	themeDetails,
}: Pick< ContentTabOverviewProps, 'selectedSite' > & {
	themeDetails?: SiteDetails[ 'themeDetails' ];
} ) {
	const blockButtonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Site Editor' ),
			icon: desktop,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php' );
			},
		},
		{
			label: __( 'Styles' ),
			icon: styles,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL(
					selectedSite.id,
					'/wp-admin/site-editor.php?path=%2Fwp_global_styles'
				);
			},
		},
		{
			label: __( 'Patterns' ),
			icon: symbolFilled,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fpatterns' );
			},
		},
		{
			label: __( 'Navigation' ),
			icon: navigation,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fnavigation' );
			},
		},
		{
			label: __( 'Templates' ),
			icon: layout,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fwp_template' );
			},
		},
		{
			label: __( 'Pages' ),
			icon: page,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fpage' );
			},
		},
	].map( ( button ) => ( {
		...button,
		disabled: ! selectedSite.running || ! themeDetails?.isBlockTheme,
	} ) );
	return <ButtonsSection buttonsArray={ blockButtonsArray } title={ __( 'Customize' ) } />;
}

function ShortcutsSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const buttonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: isMac() ? __( 'Open in finder' ) : __( 'Open in file explorer' ),
			className: 'text-nowrap',
			icon: archive,
			onClick: () => {
				getIpcApi().openLocalPath( selectedSite.path );
			},
		},
	];
	return (
		<ButtonsSection className="flex" buttonsArray={ buttonsArray } title={ __( 'Shortcuts' ) } />
	);
}

export function ContentTabOverview( { selectedSite }: ContentTabOverviewProps ) {
	const { __ } = useI18n();
	const themeDetails = useThemeDetails( selectedSite );

	return (
		<div className="pb-10 flex">
			<div className="w-52 mr-8 flex-col justify-start items-start gap-8">
				<div className="mb-3 a8c-subtitle-small">{ __( 'Theme' ) }</div>
				<div className="w-full h-60 bg-gray-100 mb-2 flex items-center justify-center">
					{ themeDetails?.thumbnailData && (
						<img
							className="w-full h-full object-cover"
							src={ themeDetails.thumbnailData }
							alt={ themeDetails?.name }
						/>
					) }
				</div>
				<div className="flex justify-between items-center w-full">
					<Button className="!px-0">{ themeDetails?.name }</Button>
				</div>
			</div>
			<div className="flex flex-1 flex-col justify-start items-start gap-8">
				<CustomizeSection selectedSite={ selectedSite } themeDetails={ themeDetails } />
				<ShortcutsSection selectedSite={ selectedSite } />
			</div>
		</div>
	);
}
