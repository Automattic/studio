import { speak } from '@wordpress/a11y';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect } from 'react';
import { useSiteDetails } from '../hooks/use-site-details';
import { isMac } from '../lib/app-globals';
import { cx } from '../lib/cx';

interface SiteMenuProps {
	className?: string;
}

function ButtonToRun( { running, id, name }: Pick< SiteDetails, 'running' | 'id' | 'name' > ) {
	const { startServer, stopServer, loadingServer } = useSiteDetails();
	const siteStartedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site started.' ),
		name
	);
	const siteStoppedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site stopped.' ),
		name
	);

	useEffect( () => {
		speak( running ? siteStartedMessage : siteStoppedMessage );
	}, [ running, siteStartedMessage, siteStoppedMessage ] );

	const classCircle = `rounded-full`;
	const triangle = (
		<svg
			width="8"
			height="10"
			viewBox="0 0 8 10"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="rtl:scale-x-[-1]"
		>
			<path
				d="M0.25 0.854923C0.25 0.663717 0.455914 0.543288 0.622565 0.63703L7.17821 4.32458C7.33948 4.41529 7.34975 4.64367 7.19728 4.74849L0.641632 9.2555C0.475757 9.36953 0.25 9.25078 0.25 9.04949V0.854923Z"
				fill="#1ED15A"
				stroke="#00BA37"
				strokeWidth="0.5"
			/>
		</svg>
	);

	const rectangle = (
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M0.25 2C0.25 1.0335 1.0335 0.25 2 0.25H8C8.9665 0.25 9.75 1.0335 9.75 2V8C9.75 8.9665 8.9665 9.75 8 9.75H2C1.0335 9.75 0.25 8.9665 0.25 8V2Z"
				fill="#FF8085"
				stroke="#F86368"
				strokeWidth="0.5"
			/>
		</svg>
	);
	return (
		<button
			aria-disabled={ loadingServer[ id ] }
			onClick={ () => {
				if ( loadingServer[ id ] ) {
					return;
				}
				return running ? stopServer( id ) : startServer( id );
			} }
			className="w-7 h-8 rounded-tr rounded-br group grid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a8c-blueberry"
			aria-label={ sprintf( running ? __( 'stop %s site' ) : __( 'start %s site' ), name ) }
		>
			{ /* Circle */ }
			<div
				className={ cx(
					'w-2.5 h-2.5 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 border-[0.5px]',
					'row-start-1 col-start-1 place-self-center',
					classCircle,
					loadingServer[ id ] && 'animate-pulse border-[#00BA3775] bg-[#1ED15A75] duration-100',
					running && 'border-[#00BA37] bg-[#1ED15A] duration-100',
					! running && ! loadingServer[ id ] && 'border-[#ffffff19] bg-[#ffffff26]'
				) }
			>
				&nbsp;
			</div>
			{ /* Shapes on hover */ }
			{ ! loadingServer[ id ] && (
				<div
					className={ cx(
						'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
						'row-start-1 col-start-1 place-self-center'
					) }
				>
					{ running ? rectangle : triangle }
				</div>
			) }
		</button>
	);
}
function SiteItem( { site }: { site: SiteDetails } ) {
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const isSelected = site === selectedSite;
	return (
		<li
			className={ cx(
				'flex flex-row min-w-[168px] h-8 hover:bg-[#ffffff0C] rounded transition-all',
				isMac() ? 'mx-5' : 'mx-4',
				isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
			) }
		>
			<button
				className="p-2 text-xs rounded-tl rounded-bl whitespace-nowrap overflow-hidden text-ellipsis w-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a8c-blueberry"
				onClick={ () => {
					setSelectedSiteId( site.id );
				} }
			>
				{ site.name }
			</button>
			<ButtonToRun { ...site } />
		</li>
	);
}

export default function SiteMenu( { className }: SiteMenuProps ) {
	const { data } = useSiteDetails();
	return (
		<nav
			aria-label={ __( 'Sites' ) }
			style={ {
				scrollbarGutter: 'stable',
			} }
			className={ cx(
				'w-full overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pb-4 app-no-drag-region',
				className
			) }
		>
			<ul className="pt-px">
				{ data.map( ( site ) => (
					<SiteItem key={ site.id } site={ site } />
				) ) }
			</ul>
		</nav>
	);
}
