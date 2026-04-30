import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Spinner,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import StudioButton from 'src/components/button';
import { EMPTY_SITE_PLAYGROUND_URL } from 'src/constants';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { AddSiteFlowType } from './options';

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
	onOptionSelect: ( option: AddSiteFlowType ) => void;
	enableBlueprints: boolean;
	blueprints: Blueprint[];
	isLoadingBlueprints: boolean;
	blueprintsErrorMessage?: string;
	selectedBlueprint: string | null;
	onBlueprintChange: ( blueprintId: string ) => void;
	blueprintFileError?: string;
}

function PreviewLink( { url }: { url: string } ) {
	const { __ } = useI18n();
	return (
		<StudioButton
			variant="secondary"
			onClick={ ( e: React.MouseEvent< HTMLButtonElement > ) => {
				e.stopPropagation();
				getIpcApi().openURL( url );
			} }
			className="!absolute bottom-2 right-2 z-10 !px-2 !py-1 !h-auto !min-h-0 text-[11px] !bg-white/90 hover:!bg-white !text-a8c-gray-900 hover:!text-a8c-gray-900 !shadow-none whitespace-nowrap"
		>
			{ __( 'Live Preview' ) }
			<ArrowIcon />
		</StudioButton>
	);
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
				<PreviewLink url={ EMPTY_SITE_PLAYGROUND_URL } />
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
				{ blueprint.playground_url && <PreviewLink url={ blueprint.playground_url } /> }
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

function getBlueprintExcerptOverrides( __: ( text: string ) => string ): Record< string, string > {
	return {
		'Quick Start': __(
			'A WordPress.com-like environment with Business plan plugins and themes pre-installed.'
		),
		Commerce: __(
			'Create your next online store with WooCommerce and its companion plugins pre-installed.'
		),
		Development: __( 'A streamlined environment for building and testing themes or plugins.' ),
	};
}

const BLUEPRINT_ORDER: Record< string, number > = {
	'Quick Start': 1,
	Commerce: 2,
	Development: 3,
};

function renameBlueprintsForDisplay(
	blueprints: Blueprint[],
	__: ( text: string ) => string
): Blueprint[] {
	const excerptOverrides = getBlueprintExcerptOverrides( __ );
	return [ ...blueprints ]
		.sort( ( a, b ) => ( BLUEPRINT_ORDER[ a.title ] ?? 99 ) - ( BLUEPRINT_ORDER[ b.title ] ?? 99 ) )
		.map( ( bp ) => ( {
			...bp,
			excerpt: excerptOverrides[ bp.title ] || bp.excerpt,
			title: BLUEPRINT_DISPLAY_NAMES[ bp.title ] || bp.title,
		} ) );
}

export function NewSiteOptions( {
	enableBlueprints,
	blueprints,
	isLoadingBlueprints,
	blueprintsErrorMessage,
	selectedBlueprint,
	onBlueprintChange,
	blueprintFileError,
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
					renameBlueprintsForDisplay( blueprints, __ ).map( ( bp ) => (
						<BlueprintCard
							key={ bp.slug }
							blueprint={ bp }
							isSelected={ selectedBlueprint === bp.slug }
							onClick={ () => handleBlueprintClick( bp.slug ) }
						/>
					) )
				) }
			</div>
		</VStack>
	);
}
