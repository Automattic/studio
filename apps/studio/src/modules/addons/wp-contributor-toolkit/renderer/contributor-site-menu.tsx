/**
 * Sidebar entry for the WordPress Contributor Toolkit addon.
 */
import { __ } from '@wordpress/i18n';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { useFocusedAddon } from 'src/modules/addons/addon-main-content';
import { WCT_ADDON_ID } from '../index.renderer';
import { useContributorContext } from './contributor-context';
import type { WctSite } from '../types';

function SiteMenuItem( {
	site,
	isActive,
	onClick,
}: {
	site: WctSite;
	isActive: boolean;
	onClick: () => void;
} ) {
	return (
		<li
			className={ cx(
				'flex flex-row min-w-[168px] h-8 hover:bg-[#ffffff0C] rounded transition-all ms-1',
				isMac() ? 'me-5' : 'me-4',
				isActive && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
			) }
		>
			<button
				type="button"
				className="p-2 text-xs rounded whitespace-nowrap overflow-hidden text-ellipsis flex-1 text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a8c-blue-50 flex items-center gap-1.5"
				onClick={ onClick }
			>
				<span className="overflow-hidden text-ellipsis">{ site.name }</span>
				{ site.watchStatus === 'running' && (
					<span className="flex-shrink-0 w-2 h-2 rounded-full bg-[#1ED15A] border border-[#00BA37]" />
				) }
			</button>
		</li>
	);
}

export function ContributorSiteMenu() {
	const { sites, activeSiteId, setActiveSite } = useContributorContext();
	const { setFocusedAddonId } = useFocusedAddon();

	if ( sites.length === 0 ) {
		return null;
	}

	return (
		<div>
			<div
				className={ cx(
					'text-[10px] uppercase tracking-wider text-a8c-gray-50 mb-2',
					isMac() ? 'ms-3' : 'ms-2'
				) }
			>
				{ __( 'WP Contribution' ) }
			</div>
			<ul className="pt-px">
				{ sites.map( ( site ) => (
					<SiteMenuItem
						key={ site.id }
						site={ site }
						isActive={ site.id === activeSiteId }
						onClick={ () => {
							setFocusedAddonId( WCT_ADDON_ID );
							void setActiveSite( site.id );
						} }
					/>
				) ) }
			</ul>
		</div>
	);
}
