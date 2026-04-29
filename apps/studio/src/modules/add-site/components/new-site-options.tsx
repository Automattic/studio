import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Spinner,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import { cx } from 'src/lib/cx';
import { GalleryBlueprint } from 'src/stores/gallery-blueprints-api';

interface Blueprint {
	slug: string;
	title: string;
	excerpt: string;
	image: string;
	playground_url: string;
	blueprint: {
		meta?: { categories?: string[]; [ key: string ]: unknown };
		[ key: string ]: unknown;
	};
	filePath?: string;
}

interface NewSiteOptionsProps {
	enableBlueprints: boolean;
	blueprints: Blueprint[];
	isLoadingBlueprints: boolean;
	blueprintsErrorMessage?: string;
	selectedBlueprint: string | null;
	onBlueprintChange: ( blueprintId: string ) => void;
	blueprintFileError?: string;
	uploadButton?: React.ReactNode;
	galleryBlueprints?: GalleryBlueprint[];
	isLoadingGallery?: boolean;
	galleryErrorMessage?: string;
	onGalleryBlueprintSelect?: ( blueprint: GalleryBlueprint ) => void;
	isSelectingGalleryBlueprint?: boolean;
	gallerySelectionError?: string;
}

function EmptySiteCard( { isSelected, onClick }: { isSelected: boolean; onClick: () => void } ) {
	const { __ } = useI18n();
	return (
		<button
			onClick={ onClick }
			className={ cx(
				'flex flex-col h-full rounded-lg border overflow-hidden text-left transition-colors',
				isSelected
					? 'border-frame-theme ring-2 ring-offset-2 ring-frame-theme ring-offset-frame'
					: 'border-frame-border hover:border-frame-text-secondary'
			) }
		>
			<div
				className="w-full h-24 [@media(min-height:680px)]:h-36 relative overflow-hidden flex items-center justify-center"
				style={ { backgroundColor: '#1f1f1f' } }
			>
				{ /* Grid overlay — matches the blueprint card treatment */ }
				<div
					className="absolute inset-0"
					style={ {
						backgroundImage:
							'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
						backgroundSize: '32px 32px',
					} }
				/>
				{ /* Centered document glyph */ }
				<svg
					width="44"
					height="56"
					viewBox="0 0 44 56"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					className="relative text-white"
				>
					<path
						d="M 4 4 L 28 4 L 40 16 L 40 52 L 4 52 Z"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinejoin="round"
						fill="none"
					/>
					<path
						d="M 28 4 L 28 16 L 40 16"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinejoin="round"
						fill="none"
					/>
				</svg>
			</div>
			<div className="px-3 pt-3 pb-3">
				<Heading level={ 3 } className="text-[13px] text-frame-text mb-1" weight={ 500 }>
					{ __( 'Empty site' ) }
				</Heading>
				<Text
					className="text-[12px] text-frame-text-secondary leading-[18px] text-pretty"
					weight={ 400 }
				>
					{ __( 'A clean WordPress install. Build whatever you want from scratch.' ) }
				</Text>
			</div>
		</button>
	);
}

function BlueprintCard( {
	blueprint,
	isSelected,
	onClick,
}: {
	blueprint: Blueprint;
	isSelected: boolean;
	onClick: () => void;
} ) {
	return (
		<button
			onClick={ onClick }
			className={ cx(
				'flex flex-col h-full rounded-lg border overflow-hidden text-left transition-colors',
				isSelected
					? 'border-frame-theme ring-2 ring-offset-2 ring-frame-theme ring-offset-frame'
					: 'border-frame-border hover:border-frame-text-secondary'
			) }
		>
			<div className="relative w-full h-24 [@media(min-height:680px)]:h-36 bg-frame-surface overflow-hidden">
				{ blueprint.image ? (
					<img
						src={ blueprint.image }
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
					title={ blueprint.excerpt }
				>
					{ blueprint.excerpt }
				</Text>
			</div>
		</button>
	);
}

const BLUEPRINT_DISPLAY_NAMES: Record< string, string > = {
	'Quick Start': 'WordPress.com',
	Development: 'WordPress Dev',
	Commerce: 'WooCommerce',
};

const getBlueprintExcerptOverrides = (): Record< string, string > => ( {
	'Quick Start': __(
		'A WordPress.com-like environment with Business plan plugins and themes pre-installed.'
	),
	Commerce: __(
		'Create your next online store with WooCommerce and its companion plugins pre-installed.'
	),
	Development: __( 'A streamlined environment for building and testing themes or plugins.' ),
} );

const BLUEPRINT_ORDER: Record< string, number > = {
	'Quick Start': 1,
	Commerce: 2,
	Development: 3,
};

function renameBlueprintsForDisplay( blueprints: Blueprint[] ): Blueprint[] {
	const excerptOverrides = getBlueprintExcerptOverrides();
	return [ ...blueprints ]
		.sort( ( a, b ) => ( BLUEPRINT_ORDER[ a.title ] ?? 99 ) - ( BLUEPRINT_ORDER[ b.title ] ?? 99 ) )
		.map( ( bp ) => ( {
			...bp,
			excerpt: excerptOverrides[ bp.title ] || bp.excerpt,
			title: BLUEPRINT_DISPLAY_NAMES[ bp.title ] || bp.title,
		} ) );
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

export function NewSiteOptions( {
	enableBlueprints,
	blueprints,
	isLoadingBlueprints,
	blueprintsErrorMessage,
	selectedBlueprint,
	onBlueprintChange,
	blueprintFileError,
	uploadButton,
	galleryBlueprints = [],
	isLoadingGallery = false,
	galleryErrorMessage,
	onGalleryBlueprintSelect,
	isSelectingGalleryBlueprint = false,
	gallerySelectionError,
}: NewSiteOptionsProps ) {
	const { __ } = useI18n();

	const handleEmptyClick = useCallback( () => {
		onBlueprintChange( 'empty' );
	}, [ onBlueprintChange ] );

	const handleBlueprintClick = useCallback(
		( slug: string ) => {
			onBlueprintChange( slug );
		},
		[ onBlueprintChange ]
	);

	return (
		<VStack className="w-full max-w-4xl mx-auto" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-frame-text mb-2" weight={ 500 }>
				{ __( 'Build a new site' ) }
			</Heading>
			<Text className="text-center text-[15px] font-light text-frame-text-secondary block mb-6">
				{ __( 'Start with an empty site or choose a template.' ) }
			</Text>

			{ uploadButton && (
				<div className="w-full max-w-2xl mx-auto mb-4 flex justify-end">{ uploadButton }</div>
			) }

			{ blueprintFileError && (
				<div className="bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm rounded-lg px-4 py-3 mb-4">
					{ blueprintFileError }
				</div>
			) }

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl mx-auto pb-1">
				<EmptySiteCard isSelected={ selectedBlueprint === 'empty' } onClick={ handleEmptyClick } />
				{ isLoadingBlueprints ? (
					<div className="flex items-center justify-center">
						<Spinner />
					</div>
				) : blueprintsErrorMessage ? (
					<div className="flex items-center justify-center text-sm text-frame-text-secondary">
						{ __( 'Could not load templates.' ) }
					</div>
				) : (
					enableBlueprints &&
					renameBlueprintsForDisplay( blueprints ).map( ( bp ) => (
						<BlueprintCard
							key={ bp.slug }
							blueprint={ bp }
							isSelected={ selectedBlueprint === bp.slug }
							onClick={ () => handleBlueprintClick( bp.slug ) }
						/>
					) )
				) }
			</div>

			{ onGalleryBlueprintSelect && (
				<>
					<Heading
						className="text-[18px] text-frame-text mt-8 mb-4 w-full max-w-2xl mx-auto"
						weight={ 500 }
					>
						{ __( 'Explore more blueprints' ) }
					</Heading>

					{ gallerySelectionError && (
						<div className="bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm rounded-lg px-4 py-3 mb-4 max-w-2xl mx-auto w-full">
							{ gallerySelectionError }
						</div>
					) }

					{ isLoadingGallery ? (
						<div className="flex items-center justify-center py-8">
							<Spinner />
						</div>
					) : galleryErrorMessage ? (
						<div className="flex items-center justify-center text-sm text-frame-text-secondary py-8">
							{ galleryErrorMessage }
						</div>
					) : (
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl mx-auto pb-1">
							{ galleryBlueprints.map( ( bp ) => (
								<GalleryBlueprintCard
									key={ bp.slug }
									blueprint={ bp }
									onClick={ () => onGalleryBlueprintSelect( bp ) }
									disabled={ isSelectingGalleryBlueprint }
								/>
							) ) }
						</div>
					) }

					{ isSelectingGalleryBlueprint && (
						<div className="flex items-center justify-center py-4">
							<Spinner />
						</div>
					) }
				</>
			) }
		</VStack>
	);
}
