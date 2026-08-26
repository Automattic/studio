import { prepareBlueprint } from '@studio/common/lib/blueprint-selection';
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

			const prepared = await prepareBlueprint( blueprintJson, {
				fallbackTitle: file.name.replace( /\.(json|zip)$/i, '' ),
				validate: ( candidate ) =>
					getIpcApi().validateBlueprint( candidate as Blueprint[ 'blueprint' ] ),
			} );
			if ( ! prepared.valid ) {
				onError( prepared.error );
				return;
			}

			const fileBlueprint: Blueprint = {
				slug: `file:${ file.name }`,
				title: prepared.title,
				excerpt: prepared.excerpt,
				image: '',
				playground_url: '',
				blueprint: prepared.blueprint as Blueprint[ 'blueprint' ],
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
