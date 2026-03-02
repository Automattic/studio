import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Tooltip } from 'src/components/tooltip';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { useVipContext } from './vip-context';
import type { VipEnvironment } from '../types';

export const VipBadge = ( { className }: { className?: string } ) => (
	<span
		className={ `inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#0675C4] text-white uppercase ${
			className ?? ''
		}` }
	>
		VIP
	</span>
);

interface VipSiteItemProps {
	environment: VipEnvironment;
	isSelected: boolean;
	isLoading: boolean;
	onSelect: () => void;
	onStart: () => Promise< boolean >;
	onStop: () => Promise< boolean >;
}

function VipSiteItem( {
	environment,
	isSelected,
	isLoading,
	onSelect,
	onStart,
	onStop,
}: VipSiteItemProps ) {
	const handleToggle = async ( e: React.MouseEvent ) => {
		e.stopPropagation();
		if ( environment.running ) {
			await onStop();
		} else {
			await onStart();
		}
	};

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

	const tooltipText = isLoading
		? __( 'Loading...' )
		: environment.running
		? __( 'Stop VIP environment' )
		: __( 'Start VIP environment' );

	return (
		<li
			className={ cx(
				'flex flex-row min-w-[168px] h-8 hover:bg-[#ffffff0C] rounded transition-all ms-1',
				isMac() ? 'me-5' : 'me-4',
				isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
			) }
		>
			<button
				type="button"
				className="p-2 text-xs rounded-tl rounded-bl whitespace-nowrap overflow-hidden text-ellipsis flex-1 text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a8c-blue-50 flex items-center gap-1.5"
				onClick={ onSelect }
			>
				<VipBadge className="flex-shrink-0" />
				<span className="overflow-hidden text-ellipsis">
					{ environment.title || environment.slug }
				</span>
			</button>
			{ isLoading ? (
				<Tooltip text={ __( 'Loading...' ) }>
					<div className="grid place-items-center w-7">
						<Spinner className="!w-2.5 !h-2.5 !top-[6px] !mr-2 [&>circle]:stroke-a8c-gray-70" />
					</div>
				</Tooltip>
			) : (
				<Tooltip text={ tooltipText }>
					<button
						type="button"
						onClick={ ( e ) => {
							void handleToggle( e );
						} }
						className="w-7 h-8 rounded-tr rounded-br group grid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a8c-blue-50"
						aria-label={
							environment.running ? __( 'Stop VIP environment' ) : __( 'Start VIP environment' )
						}
					>
						<div
							className={ cx(
								'w-2.5 h-2.5 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 border-[0.5px] rounded-full',
								'row-start-1 col-start-1 place-self-center',
								environment.running
									? 'border-[#00BA37] bg-[#1ED15A] duration-100'
									: 'border-[#ffffff19] bg-[#ffffff26]'
							) }
						/>
						<div
							className={ cx(
								'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
								'row-start-1 col-start-1 place-self-center'
							) }
						>
							{ environment.running ? rectangle : triangle }
						</div>
					</button>
				</Tooltip>
			) }
		</li>
	);
}

export function VipSiteMenu() {
	const {
		environments,
		selectedEnvironment,
		isLoading,
		isVipAvailable,
		loadingEnvironments,
		selectEnvironment,
		startEnvironment,
		stopEnvironment,
	} = useVipContext();

	if ( ! isVipAvailable && ! isLoading ) {
		return null;
	}

	if ( ! isLoading && environments.length === 0 ) {
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
				{ __( 'VIP Environments' ) }
			</div>
			{ isLoading ? (
				<div className="flex justify-center py-2">
					<Spinner className="!w-4 !h-4 [&>circle]:stroke-a8c-gray-70" />
				</div>
			) : (
				<ul className="pt-px">
					{ environments.map( ( env ) => (
						<VipSiteItem
							key={ env.slug }
							environment={ env }
							isSelected={ selectedEnvironment?.slug === env.slug }
							isLoading={ loadingEnvironments[ env.slug ] ?? false }
							onSelect={ () => selectEnvironment( env.slug ) }
							onStart={ () => startEnvironment( env.slug ) }
							onStop={ () => stopEnvironment( env.slug ) }
						/>
					) ) }
				</ul>
			) }
		</div>
	);
}
