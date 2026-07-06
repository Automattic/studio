import { generateDefaultBlueprintDescription } from '@studio/common/lib/blueprint-settings';
import { Button as WpButton } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useRef } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

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

interface UploadBlueprintButtonProps {
	onFileBlueprintSelect: ( blueprint: Blueprint ) => void;
	onError: ( error: string | undefined ) => void;
}

export function UploadBlueprintButton( {
	onFileBlueprintSelect,
	onError,
}: UploadBlueprintButtonProps ) {
	const { __ } = useI18n();
	const fileRef = useRef< HTMLInputElement | null >( null );

	const handleFileSelect = async ( event: React.ChangeEvent< HTMLInputElement > ) => {
		const file = event.target.files?.[ 0 ];
		onError( undefined );

		if ( ! file ) {
			return;
		}

		try {
			const isZip = file.type === 'application/zip' || file.name.endsWith( '.zip' );
			const isJson = file.type === 'application/json' || file.name.endsWith( '.json' );

			let blueprintJson: Record< string, unknown >;
			let filePath: string;

			if ( isZip ) {
				const zipPath = getIpcApi().getPathForFile( file );
				const extracted = await getIpcApi().extractBlueprintBundle( zipPath );
				blueprintJson = extracted.blueprintJson;
				filePath = extracted.blueprintJsonPath;
			} else if ( isJson ) {
				const text = await file.text();
				blueprintJson = JSON.parse( text );
				filePath = getIpcApi().getPathForFile( file );
			} else {
				return;
			}

			const meta = blueprintJson as {
				version?: number;
				meta?: { title?: string; description?: string };
			};

			if ( meta.version === 2 ) {
				onError( __( 'Blueprint v2 format is not supported yet. Please use v1.' ) );
				return;
			}

			const validation = await getIpcApi().validateBlueprint( blueprintJson );
			if ( ! validation.valid ) {
				onError( validation.error || __( 'Invalid Blueprint format' ) );
				return;
			}

			const baseName = file.name.replace( /\.(json|zip)$/, '' );
			const fileBlueprint: Blueprint = {
				slug: `file:${ file.name }`,
				title: meta.meta?.title || baseName,
				excerpt:
					meta.meta?.description ||
					generateDefaultBlueprintDescription(
						blueprintJson as Parameters< typeof generateDefaultBlueprintDescription >[ 0 ]
					),
				image: '',
				playground_url: '',
				blueprint: blueprintJson,
				filePath,
			};

			onFileBlueprintSelect( fileBlueprint );
		} catch ( error ) {
			if ( error instanceof SyntaxError ) {
				onError( sprintf( __( 'Invalid JSON: %s' ), error.message ) );
			} else {
				onError( __( 'Failed to load Blueprint file.' ) );
			}
		}

		if ( fileRef.current ) {
			fileRef.current.value = '';
		}
	};

	return (
		<label>
			<input
				ref={ fileRef }
				type="file"
				accept=".json,.zip,application/json,application/zip"
				onChange={ handleFileSelect }
				className="hidden"
			/>
			<WpButton
				variant="tertiary"
				className="cursor-pointer"
				onClick={ () => fileRef.current?.click() }
			>
				{ __( 'Upload a blueprint' ) }
			</WpButton>
		</label>
	);
}
