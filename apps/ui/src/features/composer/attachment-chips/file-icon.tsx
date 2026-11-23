import {
	CodeIcon,
	FileArchiveIcon,
	FileHtmlIcon,
	FileIcon,
	FileJsIcon,
	FileJsxIcon,
	FilePdfIcon,
	FileTextIcon,
	TableIcon,
} from '@studio/ds/icons';
import type { ComposerFileAttachment } from '@studio/agent/protocol/composer-attachments';
import type { ReactElement } from 'react';

const fileIconGroups: { icon: ReactElement; extensions: string[]; mimeTypes: string[] }[] = [
	{
		icon: <FileArchiveIcon />,
		extensions: [ 'zip' ],
		mimeTypes: [ 'application/zip', 'application/x-zip-compressed' ],
	},
	{
		icon: <FilePdfIcon />,
		extensions: [ 'pdf' ],
		mimeTypes: [ 'application/pdf' ],
	},
	{
		icon: <FileHtmlIcon />,
		extensions: [ 'html', 'htm', 'xhtml' ],
		mimeTypes: [ 'text/html', 'application/xhtml+xml' ],
	},
	{
		icon: <FileJsIcon />,
		extensions: [ 'js', 'mjs', 'cjs' ],
		mimeTypes: [ 'application/javascript', 'text/javascript' ],
	},
	{
		icon: <FileJsxIcon />,
		extensions: [ 'jsx' ],
		mimeTypes: [ 'text/jsx', 'text/x-jsx' ],
	},
	{
		icon: <TableIcon />,
		extensions: [ 'csv', 'tsv', 'xls', 'xlsx', 'ods' ],
		mimeTypes: [
			'text/csv',
			'text/tab-separated-values',
			'application/vnd.ms-excel',
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'application/vnd.oasis.opendocument.spreadsheet',
		],
	},
	{
		icon: <CodeIcon />,
		extensions: [
			'css',
			'scss',
			'sass',
			'less',
			'php',
			'ts',
			'tsx',
			'json',
			'jsonc',
			'yaml',
			'yml',
			'xml',
		],
		mimeTypes: [
			'text/css',
			'application/x-httpd-php',
			'application/typescript',
			'text/typescript',
			'application/json',
			'application/yaml',
			'text/yaml',
			'application/xml',
			'text/xml',
		],
	},
	{
		icon: <FileTextIcon />,
		extensions: [ 'txt', 'md', 'markdown', 'rtf' ],
		mimeTypes: [ 'application/rtf' ],
	},
];

export function getComposerFileIcon( {
	name,
	mimeType,
}: Pick< ComposerFileAttachment, 'name' | 'mimeType' > ) {
	const extension = /\.([^.]+)$/.exec( name.toLowerCase() )?.[ 1 ] ?? '';
	const type = ( mimeType?.split( ';', 1 )[ 0 ] ?? '' ).trim().toLowerCase();

	return (
		fileIconGroups.find( ( group ) => group.extensions.includes( extension ) )?.icon ??
		fileIconGroups.find( ( group ) => group.mimeTypes.includes( type ) )?.icon ??
		( type.startsWith( 'text/' ) ? <FileTextIcon /> : <FileIcon /> )
	);
}
