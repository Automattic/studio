import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Spinner,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { cx } from 'src/lib/cx';
import { GalleryBlueprint } from 'src/stores/gallery-blueprints-api';

interface ExploreBlueprintsProps {
	blueprints: GalleryBlueprint[];
	isLoading: boolean;
	errorMessage?: string;
	onBlueprintSelect: ( blueprint: GalleryBlueprint ) => void;
	isSelectingBlueprint: boolean;
	selectionError?: string;
}

function GalleryBlueprintCard( {
	blueprint,
	onClick,
	disabled,
}: {
	blueprint: GalleryBlueprint;
	onClick: () => void;
	disabled: boolean;
} ) {
	return (
		<button
			onClick={ onClick }
			disabled={ disabled }
			className={ cx(
				'flex flex-col h-full rounded-lg border overflow-hidden text-left transition-colors',
				disabled
					? 'opacity-50 cursor-not-allowed border-frame-border'
					: 'border-frame-border hover:border-frame-text-secondary'
			) }
		>
			<div className="relative w-full h-24 [@media(min-height:680px)]:h-36 bg-frame-surface overflow-hidden">
				{ blueprint.screenshotUrl ? (
					<img
						src={ blueprint.screenshotUrl }
						alt={ blueprint.title }
						className="w-full h-full object-cover object-center"
					/>
				) : (
					<div className="w-full h-full flex items-center justify-center text-frame-text-tertiary">
						{ blueprint.title }
					</div>
				) }
			</div>
			<div className="px-3 pt-3 pb-3">
				<Heading level={ 3 } className="text-[13px] text-frame-text mb-1" weight={ 500 }>
					{ blueprint.title }
				</Heading>
				<Text
					className="text-[12px] text-frame-text-secondary leading-[18px] text-pretty"
					weight={ 400 }
					title={ blueprint.description }
				>
					{ blueprint.description }
				</Text>
			</div>
		</button>
	);
}

export function ExploreBlueprints( {
	blueprints,
	isLoading,
	errorMessage,
	onBlueprintSelect,
	isSelectingBlueprint,
	selectionError,
}: ExploreBlueprintsProps ) {
	const { __ } = useI18n();

	return (
		<VStack className="w-full max-w-4xl mx-auto" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-frame-text mb-2" weight={ 500 }>
				{ __( 'Explore blueprints' ) }
			</Heading>
			<Text className="text-center text-[15px] font-light text-frame-text-secondary block mb-6">
				{ __( 'Community blueprints from the WordPress Blueprints library.' ) }
			</Text>

			{ selectionError && (
				<div className="bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm rounded-lg px-4 py-3 mb-4 max-w-3xl mx-auto w-full">
					{ selectionError }
				</div>
			) }

			{ isLoading ? (
				<div className="flex items-center justify-center py-8">
					<Spinner />
				</div>
			) : errorMessage ? (
				<div className="flex items-center justify-center text-sm text-frame-text-secondary py-8">
					{ __( 'Could not load blueprints.' ) }
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-3xl mx-auto pb-1">
					{ blueprints.map( ( bp ) => (
						<GalleryBlueprintCard
							key={ bp.slug }
							blueprint={ bp }
							onClick={ () => onBlueprintSelect( bp ) }
							disabled={ isSelectingBlueprint }
						/>
					) ) }
				</div>
			) }

			{ isSelectingBlueprint && (
				<div className="flex items-center justify-center py-4">
					<Spinner />
				</div>
			) }
		</VStack>
	);
}
