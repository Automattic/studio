import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
} from '@wordpress/components';
import { Icon, chevronRight, chevronLeft, backup, wordpress } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { cx } from 'src/lib/cx';
import type { AddSiteFlowType } from './options';

interface ConnectOptionsProps {
	onOptionSelect: ( option: AddSiteFlowType ) => void;
}

function OptionCard( {
	icon,
	title,
	description,
	onClick,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	onClick: () => void;
} ) {
	const { isRTL } = useI18n();
	const chevron = isRTL() ? chevronLeft : chevronRight;
	return (
		<HStack
			as="button"
			className={ cx(
				'w-full p-5 border border-frame-border rounded-xl text-left',
				'rtl:text-right',
				'hover:border-frame-text-secondary hover:bg-frame-surface'
			) }
			alignment="center"
			onClick={ onClick }
			spacing={ 4 }
		>
			<div className="shrink-0">{ icon }</div>
			<VStack className="flex-1 gap-1">
				<Heading className="text-base" weight="500">
					{ title }
				</Heading>
				<Text className="text-sm text-frame-text-secondary" weight="400">
					{ description }
				</Text>
			</VStack>
			<Icon
				className="text-frame-text-secondary shrink-0"
				icon={ chevron }
				size={ 24 }
				fill="currentColor"
			/>
		</HStack>
	);
}

export function ConnectOptions( { onOptionSelect }: ConnectOptionsProps ) {
	const { __ } = useI18n();

	return (
		<VStack className="text-center w-full" alignment="top" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-frame-text mb-2" weight={ 500 }>
				{ __( 'Connect an existing site' ) }
			</Heading>
			<Text className="text-center text-[15px] font-light text-frame-text-secondary block mb-6">
				{ __( "Choose how you'd like to bring your site into Studio." ) }
			</Text>
			<div className="flex flex-col gap-3 w-full max-w-[460px]">
				<OptionCard
					icon={ <Icon icon={ wordpress } size={ 28 } fill="var(--color-frame-theme)" /> }
					title={ __( 'From WordPress.com' ) }
					description={ __( 'Connect a WordPress.com or Pressable site to sync locally.' ) }
					onClick={ () => onOptionSelect( 'pullRemote' ) }
				/>
				<OptionCard
					icon={ <Icon icon={ backup } size={ 28 } fill="var(--color-frame-theme)" /> }
					title={ __( 'From a backup file' ) }
					description={ __( 'Import a .zip, .tar.gz, .sql, or .wpress backup.' ) }
					onClick={ () => onOptionSelect( 'backup' ) }
				/>
			</div>
		</VStack>
	);
}
