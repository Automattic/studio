import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useI18nData } from '../hooks/use-i18n-data';
import { isMac, isWindows } from '../lib/app-globals';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

const SiteItemSkeleton = () => {
	return (
		<div className="flex flex-row items-center justify-between w-full h-8">
			<div className="flex items-center">
				<div className="ml-2 w-[100px] h-[13px] bg-[#ffffff1a] animate-pulse" />
			</div>
			<div className="w-3 h-3 bg-[#ffffff1a] rounded-full animate-pulse" />
		</div>
	);
};

const SitesSkeleton = () => {
	return (
		<div className={ cx( 'flex flex-row min-w-[168px]', isMac() ? 'mx-5' : 'mx-4' ) }>
			<div className="w-full overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pb-4 app-no-drag-region sites-scrollbar">
				<SiteItemSkeleton />
				<SiteItemSkeleton />
				<SiteItemSkeleton />
				<SiteItemSkeleton />
				<SiteItemSkeleton />
			</div>
		</div>
	);
};
const ButtonSkeleton = () => {
	return <div className="w-full h-8 bg-[#ffffff1a] rounded-sm animate-pulse" />;
};

const GravatarSkeleton = () => {
	return (
		<>
			<span className="border border-[#ffffff1a] bg-transparent animate-pulse w-4 h-4 rounded-full"></span>
			<span className="border border-[#ffffff1a] bg-transparent animate-pulse ml-3.5 h-4 w-4 rounded-full"></span>
		</>
	);
};

const RightPanel = () => {
	const { __ } = useI18n();
	const { locale } = useI18nData();
	const openLocalizedSupport = async () => {
		await getIpcApi().openURL( `https://wordpress.com/${ locale }/support` );
	};
	return (
		<div className="flex flex-col justify-center h-full">
			<div className="text-a8c-gray-20 text-[54px] font-normal leading-[54px]">
				{ __( 'Uh oh!' ) }
			</div>
			<div className="text-black font-normal text-xl leading-[28px] mt-2">
				{ __( "Something's broken." ) }
			</div>
			<div className="mt-6 mb-8 text-a8c-gray-70 leading-[18px] text-[13px]">
				<p>{ __( 'We’ve logged the issue to help us track down the problem.' ) }</p>
				<p>
					{ __( 'Try restarting the app, if the problem persists' ) }{ ' ' }
					<Button
						className="text-[13px]"
						aria-label={ __( 'Help' ) }
						onClick={ openLocalizedSupport }
						variant="link"
					>
						{ __( 'contact support.' ) }
					</Button>
				</p>
			</div>
			<div>
				<Button
					className="bg-a8c-blueberry hover:text-white text-white"
					variant="primary"
					onClick={ () => window.location.reload() }
				>
					{ __( 'Restart' ) }
				</Button>
			</div>
		</div>
	);
};

export default function DefaultErrorFallback() {
	return (
		<VStack
			className={ cx(
				'h-screen bg-chrome backdrop-blur-3xl pr-chrome app-drag-region',
				isWindows() && 'pt-0 pb-chrome',
				! isWindows() && 'py-chrome'
			) }
			spacing="0"
		>
			<HStack spacing="0" alignment="left" className="flex-grow">
				<div
					data-testid="main-sidebar"
					className={ cx(
						'text-chrome-inverted basis-52 flex-shrink-0 h-full',
						isMac() && 'pt-[50px]',
						! isMac() && 'pt-[60px]'
					) }
				>
					<div className="flex flex-col h-full">
						<div
							className={ cx(
								'w-full overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pb-4'
							) }
						>
							<SitesSkeleton />
						</div>
						<div className="mt-auto min-h-[103px] pt-5">
							<div className={ cx( isMac() ? 'mx-5' : 'mx-4' ) }>
								<div className="w-full mb-5">
									<ButtonSkeleton />
								</div>
								<div className="flex items-center justify-start w-full ml-1">
									<GravatarSkeleton />
								</div>
							</div>
						</div>
					</div>
				</div>
				<div className="p-16 bg-white overflow-y-auto h-full flex-grow rounded-chrome app-no-drag-region">
					<RightPanel />
				</div>
			</HStack>
		</VStack>
	);
}
