import { prepareBlueprint } from '@studio/common/lib/blueprint-selection';
import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Button,
	Notice,
} from '@wordpress/components';
import { DataViews, View } from '@wordpress/dataviews';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { Icon, external, upload } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useRef, useState, useMemo } from 'react';
import StudioButton from 'src/components/button';
import { LearnMoreLink } from 'src/components/learn-more';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useI18nLocale } from 'src/stores';
import { useGetBlueprints } from 'src/stores/wpcom-api';
import type { BlueprintValidationWarning } from '@studio/common/lib/blueprint-validation';

import './blueprints.css';

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
	filePath?: string;
}

interface DataViewBlueprint extends Blueprint {
	isSelected: boolean;
	categories: string[];
}

interface AddSiteBlueprintProps {
	blueprints: Blueprint[];
	errorMessage?: string;
	isLoading: boolean;
	selectedBlueprint: string | null;
	onBlueprintChange: ( blueprintId: string ) => void;
	onFileBlueprintSelect?: ( blueprint: Blueprint, warnings?: BlueprintValidationWarning[] ) => void;
}

export function AddSiteBlueprintSelector( {
	blueprints,
	errorMessage,
	isLoading,
	selectedBlueprint,
	onBlueprintChange,
	onFileBlueprintSelect,
}: AddSiteBlueprintProps ) {
	const { __ } = useI18n();
	const locale = useI18nLocale();
	const { refetch: refetchBlueprints, isFetching: isFetchingBlueprints } = useGetBlueprints( {
		locale,
	} );
	const fileRef = useRef< HTMLInputElement | null >( null );
	const [ validationError, setValidationError ] = useState< string | undefined >( undefined );
	const [ uploadedFileName, setUploadedFileName ] = useState< string | null >( null );

	// Check if current selection is a file-based blueprint
	const isFileBasedSelection = selectedBlueprint && selectedBlueprint.startsWith( 'file:' );
	const selectedFileName =
		uploadedFileName || ( isFileBasedSelection ? selectedBlueprint.replace( 'file:', '' ) : null );

	const handleRemoveFile = useCallback( () => {
		onBlueprintChange( '' );
		setValidationError( undefined );
		setUploadedFileName( null );
		if ( fileRef.current ) {
			fileRef.current.value = '';
		}
	}, [ onBlueprintChange ] );

	const handleBlueprintClick = useCallback(
		( item: DataViewBlueprint ) => {
			setValidationError( undefined );
			onBlueprintChange( item.slug );
		},
		[ onBlueprintChange ]
	);

	const handlePreviewClick = useCallback(
		( e: React.MouseEvent< HTMLButtonElement >, item: DataViewBlueprint ) => {
			e.stopPropagation();
			getIpcApi().openURL( item.playground_url );
		},
		[]
	);

	const [ view, setView ] = useState< View >( {
		type: 'grid',
		perPage: 9,
		page: 1,
		fields: [ 'excerpt' ],
		mediaField: 'image',
		titleField: 'title',
		search: '',
		filters: [],
		layout: {
			badgeFields: [ 'excerpt' ],
		},
	} );

	const fields = useMemo(
		() => [
			{
				id: 'image',
				label: __( 'Thumbnail' ),
				type: 'media' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<div
						className={ cx(
							'w-full bg-frame-surface h-32 rounded-t overflow-hidden',
							'[@media(min-height:680px)]:h-[175px]',
							item.isSelected && 'is-selected'
						) }
					>
						<img
							src={ item.image }
							alt={ item.title }
							className="w-full h-full object-cover object-center"
						/>
					</div>
				),
			},
			{
				id: 'title',
				label: __( 'Title' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<HStack
						alignment="edge"
						style={ { alignItems: 'baseline', paddingTop: '24px', paddingBottom: '10px' } }
						wrap
					>
						<Heading level={ 3 } className="text-[13px] text-frame-text" weight={ 500 }>
							{ item.title }
						</Heading>
						<StudioButton
							variant="link"
							className="!p-0 text-[12px] [&.is-link]:text-frame-text-secondary [&.is-link]:hover:text-frame-theme whitespace-nowrap"
							onClick={ ( e: React.MouseEvent< HTMLButtonElement > ) =>
								handlePreviewClick( e, item )
							}
						>
							{ __( 'Preview Blueprint' ) }
							<Icon icon={ external } size={ 16 } className="ml-1" />
						</StudioButton>
					</HStack>
				),
			},
			{
				id: 'excerpt',
				label: __( 'Description' ),
				type: 'text' as const,
				render: ( { item }: { item: DataViewBlueprint } ) => (
					<div className="px-5 pb-5" onClick={ () => handleBlueprintClick( item ) }>
						<Text
							className="text-[13px] text-frame-text-secondary h-[80px] leading-5"
							weight={ 400 }
							truncate
							numberOfLines={ 4 }
							title={ item.excerpt }
						>
							{ item.excerpt }
						</Text>
					</div>
				),
			},
		],
		[ handleBlueprintClick, handlePreviewClick, __ ]
	);

	const validateAndBuildBlueprint = async (
		blueprintJson: Blueprint[ 'blueprint' ],
		fileName: string,
		filePath: string,
		onCleanup?: () => void
	): Promise< {
		blueprint: Blueprint;
		warnings: BlueprintValidationWarning[] | undefined;
	} | null > => {
		const prepared = await prepareBlueprint( blueprintJson, {
			fallbackTitle: fileName.replace( /\.(json|zip)$/i, '' ),
			validate: ( candidate ) =>
				getIpcApi().validateBlueprint( candidate as Blueprint[ 'blueprint' ] ),
		} );
		if ( ! prepared.valid ) {
			setValidationError( prepared.error );
			onCleanup?.();
			return null;
		}

		const blueprint: Blueprint = {
			slug: `file:${ fileName }`,
			title: prepared.title,
			excerpt: prepared.excerpt,
			image: '',
			playground_url: '',
			blueprint: prepared.blueprint as Blueprint[ 'blueprint' ],
			filePath,
		};

		return { blueprint, warnings: prepared.warnings };
	};

	const handleFileSelect = async ( event: React.ChangeEvent< HTMLInputElement > ) => {
		const file = event.target.files?.[ 0 ];
		setValidationError( undefined );
		setUploadedFileName( null );

		const isJson = file?.type === 'application/json' || file?.name.endsWith( '.json' );
		const isZip = file?.type === 'application/zip' || file?.name.endsWith( '.zip' );

		if ( file && isJson && onFileBlueprintSelect ) {
			setUploadedFileName( file.name );

			try {
				const text = await file.text();
				const blueprintJson = JSON.parse( text );
				const result = await validateAndBuildBlueprint(
					blueprintJson,
					file.name,
					getIpcApi().getPathForFile( file )
				);
				if ( result ) {
					onFileBlueprintSelect( result.blueprint, result.warnings );
				}
				setUploadedFileName( null );
			} catch ( error ) {
				if ( error instanceof SyntaxError ) {
					setValidationError(
						sprintf(
							// translators: %s is error message of the JSON parsing error
							__( 'Invalid JSON format: %s' ),
							error.message
						)
					);
				} else {
					setValidationError( __( 'Failed to load Blueprint file. Please try again.' ) );
				}
				console.error( 'Failed to parse Blueprint file:', error );
			}
		} else if ( file && isZip && onFileBlueprintSelect ) {
			setUploadedFileName( file.name );
			let tempDir: string | undefined;

			try {
				const zipPath = getIpcApi().getPathForFile( file );
				const extracted = await getIpcApi().extractBlueprintBundle( zipPath );
				tempDir = extracted.tempDir;
				const result = await validateAndBuildBlueprint(
					extracted.blueprintJson,
					file.name,
					extracted.blueprintJsonPath,
					() => void getIpcApi().cleanupBlueprintTempDir( extracted.tempDir )
				);
				if ( result ) {
					onFileBlueprintSelect( result.blueprint, result.warnings );
				}
				setUploadedFileName( null );
			} catch ( error ) {
				if ( tempDir ) {
					void getIpcApi().cleanupBlueprintTempDir( tempDir );
				}
				if ( error instanceof SyntaxError ) {
					setValidationError(
						sprintf( __( 'Invalid JSON format in blueprint.json: %s' ), error.message )
					);
				} else {
					setValidationError( __( 'Failed to load Blueprint ZIP file. Please try again.' ) );
				}
			}
		}
		if ( fileRef.current ) {
			fileRef.current.value = '';
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
			<VStack className="w-full max-w-6xl mx-auto">
				<Heading className="text-center text-[32px] text-frame-text mb-[28px]" weight={ 500 }>
					{ __( 'Start from a Blueprint' ) }
				</Heading>
				<Text>{ __( 'Loading Blueprints...' ) }</Text>
			</VStack>
		);
	}

	return (
		<VStack className="w-full max-w-4xl mx-auto px-0.5" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-frame-text mb-1" weight={ 500 }>
				{ __( 'Start from a Blueprint' ) }
			</Heading>
			<Text className="text-center text-frame-text-secondary mb-4">
				{ createInterpolateElement(
					__( 'Create a new site from a featured Blueprint on your own. <learn_more_link />' ),
					{
						learn_more_link: <LearnMoreLink docsLinksKey="docsBlueprints" />,
					}
				) }
			</Text>

			{ validationError && (
				<Notice
					status="error"
					isDismissible={ false }
					onRemove={ () => setValidationError( undefined ) }
					className="mx-0 mb-4"
				>
					<strong>{ __( 'Blueprint validation failed' ) }</strong>
					<br />
					{ validationError }
				</Notice>
			) }

			<HStack alignment="edge" className="w-full mb-5 h-7">
				<HStack alignment="left" className="flex-1">
					<Text className="text-[16px]" weight={ 500 }>
						{ __( 'Featured Blueprints' ) }
					</Text>
				</HStack>
				{ selectedFileName ? (
					<HStack className="flex-1 items-center justify-end gap-1">
						<Text
							className="text-sm font-medium text-frame-text truncate max-w-48"
							title={ selectedFileName }
						>
							{ selectedFileName }
						</Text>
						<Button variant="tertiary" size="small" onClick={ handleRemoveFile } isDestructive>
							{ __( 'Remove' ) }
						</Button>
					</HStack>
				) : (
					<label className="flex-shrink-0">
						<input
							ref={ fileRef }
							type="file"
							accept=".json,.zip,application/json,application/zip"
							onChange={ handleFileSelect }
							className="hidden"
						/>
						<Button
							variant="secondary"
							className="flex-shrink-0 cursor-pointer"
							onClick={ () => {
								fileRef.current?.click();
							} }
							icon={ upload }
						>
							{ __( 'Choose Blueprint file' ) }
						</Button>
					</label>
				) }
			</HStack>

			<div className="blueprints-container w-full pb-1">
				{ isFetchingBlueprints && (
					<Text className="text-[14px] block text-center py-[100px]">
						{ __( 'Loading Blueprints...' ) }
					</Text>
				) }
				{ errorMessage && ! isFetchingBlueprints && (
					<Text className="text-[14px] block text-center py-[100px]">
						{ createInterpolateElement(
							__(
								'Studio could not load Blueprints. <button>Try again</button> or use your own Blueprint.'
							),
							{
								button: <Button variant="link" onClick={ refetchBlueprints } />,
							}
						) }
					</Text>
				) }

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
					onClickItem={ handleBlueprintClick }
					isItemClickable={ () => true }
				>
					<DataViews.Layout />
				</DataViews>
			</div>
		</VStack>
	);
}
