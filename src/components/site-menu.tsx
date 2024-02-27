import { __, sprintf } from '@wordpress/i18n';
import { useSiteDetails } from '../hooks/use-site-details';
import { isMac } from '../lib/app-globals';
import { cx } from '../lib/cx';

interface SiteMenuProps {
	className?: string;
}

function ButtonToRun( { running, id, name }: Pick< SiteDetails, 'running' | 'id' | 'name' > ) {
	const { startServer, stopServer } = useSiteDetails();
	const classCircle = `rounded-full`;
	const triangle = (
		<svg width="8" height="10" viewBox="0 0 8 10" fill="none" xmlns="http://www.w3.org/2000/svg">
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
			onClick={ () => ( running ? stopServer( id ) : startServer( id ) ) }
			className="w-7 h-8 group grid"
			aria-label={ sprintf( running ? __( 'stop site %s' ) : __( 'start site %s' ), name ) }
		>
			{ /* Circle */ }
			<div
				className={ cx(
					'w-2.5 h-2.5 transition-opacity group-hover:opacity-0 border-[0.5px]',
					'row-start-1 col-start-1 place-self-center',
					classCircle,
					running && 'border-[#00BA37] bg-[#1ED15A]',
					! running && 'border-[#ffffff19] bg-[#ffffff26]'
				) }
			>
				&nbsp;
			</div>
			{ /* Shapes on hover */ }
			<div
				className={ cx(
					'opacity-0 transition-opacity group-hover:opacity-100',
					'row-start-1 col-start-1 place-self-center'
				) }
			>
				{ running ? rectangle : triangle }
			</div>
		</button>
	);
}
function SiteItem( { site }: { site: SiteDetails } ) {
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const isSelected = site === selectedSite;
	return (
		<div
			className={ cx(
				'flex flex-row w-auto max-w-full h-8 hover:bg-[#ffffff0C] rounded transition-all',
				isMac() ? 'mx-5' : 'mx-4',
				isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
			) }
		>
			<button
				className="p-2 text-xs whitespace-nowrap overflow-hidden text-ellipsis w-full text-left"
				onClick={ () => {
					setSelectedSiteId( site.id );
				} }
			>
				{ site.name }
			</button>
			<ButtonToRun { ...site } />
		</div>
	);
}

export default function SiteMenu( { className }: SiteMenuProps ) {
	const { data } = useSiteDetails();
	return (
		<div
			className={ cx(
				'w-full overflow-y-auto flex flex-col gap-0.5 pb-4 app-no-drag-region sites-scrollbar',
				className
			) }
		>
			{ data.map( ( site ) => (
				<SiteItem key={ site.id } site={ site } />
			) ) }
		</div>
	);
}
