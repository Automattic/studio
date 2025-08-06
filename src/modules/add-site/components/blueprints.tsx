import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Button,
} from '@wordpress/components';
import { DataViews, View } from '@wordpress/dataviews';
import { Icon, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useRef, useState, useMemo } from 'react';
import StudioButton from 'src/components/button';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface Blueprint {
	slug: string;
	title: string;
	excerpt: string;
	image: string;
	playground_url: string;
	blueprint: {
		meta?: {
			categories?: string[];
			[ key: string ]: unknown;
		};
		[ key: string ]: unknown;
	};
}

interface DataViewBlueprint extends Blueprint {
	isSelected: boolean;
	categories: string[];
}

interface AddSiteBlueprintProps {
	blueprints: Blueprint[];
	isLoading: boolean;
	selectedBlueprint: string | null;
	onBlueprintChange: ( blueprintId: string ) => void;
}

export default function AddSiteBlueprint( {
	blueprints,
	isLoading,
	selectedBlueprint,
	onBlueprintChange,
}: AddSiteBlueprintProps ) {
	const { __ } = useI18n();
	const fileRef = useRef< HTMLInputElement | null >( null );
	const [ view, setView ] = useState< View >( {
		type: 'grid',
		perPage: 9,
		page: 1,
		fields: [ 'categories', 'excerpt', 'preview' ],
		mediaField: 'image',
		titleField: 'title',
		search: '',
		filters: [],
		layout: {
			badgeFields: [ 'categories', 'excerpt', 'preview' ],
		},
	} );

	const fields = useMemo(
		() => [
			{
				id: 'image',
				label: __( 'Thumbnail' ),
				type: 'media' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<img
						src={ item.image }
						alt={ item.title }
						className={ cx(
							'w-full h-48 object-cover object-top cursor-pointer transition-all duration-150 rounded-lg group',
							'hover:shadow-md hover:outline hover:outline-2 hover:outline-blue-500',
							'transition-transform duration-150',
							'hover:scale-105',
							item.isSelected && 'outline outline-2 outline-blue-500 shadow-md scale-105'
						) }
					/>
				),
			},
			{
				id: 'title',
				label: __( 'Title' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<Heading level={ 3 } className="text-sm mt-3 mb-2 text-gray-800" weight={ 500 }>
						{ item.title }
					</Heading>
				),
			},
			{
				id: 'excerpt',
				label: __( 'Description' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<Text
						className="text-sm text-gray-600 h-16"
						weight={ 400 }
						truncate
						numberOfLines={ 3 }
						title={ item.excerpt }
					>
						{ item.excerpt }
					</Text>
				),
			},
			{
				id: 'categories',
				label: __( 'Categories' ),
				type: 'array' as const,
				elements: blueprints
					.flatMap( ( blueprint ) => blueprint.blueprint.meta?.categories || [] )
					.filter( ( category, index, arr ) => arr.indexOf( category ) === index )
					.map( ( category ) => ( { label: category, value: category } ) ),
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<HStack spacing={ 3 } wrap alignment="left">
						{ ( item.blueprint.meta?.categories || [] )
							.filter( ( category ) => category !== 'Studio' )
							.map( ( category ) => (
								<Text
									as="span"
									key={ category }
									className="px-2.5 py-1 text-xs bg-gray-100 text-gray-700 rounded-sm flex items-center"
								>
									{ category }
								</Text>
							) ) }
					</HStack>
				),
			},
			{
				id: 'preview',
				label: __( 'Preview' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<StudioButton
						variant="link"
						size="small"
						className="!p-0"
						onClick={ () => getIpcApi().openURL( item.playground_url ) }
					>
						{ __( 'Preview blueprint' ) }
						<Icon icon={ external } size={ 16 } className="ml-1" />
					</StudioButton>
				),
			},
		],
		[ blueprints, __ ]
	);

	const handleFileSelect = ( event: React.ChangeEvent< HTMLInputElement > ) => {
		const file = event.target.files?.[ 0 ];
		if ( file && file.type === 'application/json' ) {
			console.log( 'Selected JSON file:', file.name );
		}
	};

	const paginationInfo = useMemo(
		() => ( {
			totalItems: blueprints.length,
			totalPages: Math.ceil( blueprints.length / ( view.perPage || 9 ) ),
		} ),
		[ blueprints.length, view.perPage ]
	);

	const dataViewBlueprints = useMemo(
		() =>
			blueprints.map( ( blueprint ) => ( {
				...blueprint,
				isSelected: blueprint.slug === selectedBlueprint,
				categories: blueprint.blueprint.meta?.categories || [],
			} ) ),
		[ blueprints, selectedBlueprint ]
	);

	if ( isLoading ) {
		return (
			<VStack className="w-full max-w-6xl mx-auto" spacing={ 6 }>
				<Heading className="text-center text-4xl">{ __( 'Start from a blueprint' ) }</Heading>
				<Text>{ __( 'Loading blueprints...' ) }</Text>
			</VStack>
		);
	}

	return (
		<VStack className="w-full max-w-6xl mx-auto p-2" spacing={ 6 }>
			<Heading className="text-center text-4xl">{ __( 'Start from a blueprint' ) }</Heading>

			<HStack spacing={ 2 } alignment="edge" className="w-full pr-1">
				<HStack alignment="left" className="flex-1">
					<Text className="text-xl" weight={ 500 }>
						{ __( 'Suggested blueprints' ) }
					</Text>
				</HStack>
				<label className="flex-shrink-0">
					<input
						ref={ fileRef }
						type="file"
						accept=".json,application/json"
						onChange={ handleFileSelect }
						className="hidden"
					/>
					<Button
						variant="secondary"
						className="flex-shrink-0 cursor-pointer"
						onClick={ () => {
							fileRef.current?.click();
						} }
					>
						{ __( 'Choose blueprint file' ) }
					</Button>
				</label>
			</HStack>

			<div className="w-full px-2 [&_.dataviews-view-grid]:!grid-cols-3 [&_.components-badge]:!bg-transparent [&_.components-badge]:!p-0">
				<DataViews
					data={ dataViewBlueprints }
					fields={ fields }
					view={ view }
					onChangeView={ setView }
					defaultLayouts={ {
						grid: {},
					} }
					paginationInfo={ paginationInfo }
					getItemId={ ( item: DataViewBlueprint ) => item.slug }
					selection={ selectedBlueprint ? [ selectedBlueprint ] : [] }
					onClickItem={ ( item ) => onBlueprintChange( item.slug ) }
					isItemClickable={ () => true }
				>
					<DataViews.Layout />
				</DataViews>
			</div>
		</VStack>
	);
}
