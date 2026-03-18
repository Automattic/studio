import fs from 'fs/promises';
import nodePath from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { getAiInstructionsPath } from 'src/lib/server-files-paths';
import { INSTRUCTION_FILES, INSTRUCTION_FILE_TYPES, type InstructionFileType } from '../constants';

export interface InstructionFileStatus {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
	exists: boolean;
	path: string;
}

export function getInstructionFilePath( sitePath: string, fileType: InstructionFileType ): string {
	return nodePath.join( sitePath, INSTRUCTION_FILES[ fileType ].fileName );
}

async function getBundledContent( fileType: InstructionFileType ): Promise< string | null > {
	const bundledPath = nodePath.join(
		getAiInstructionsPath(),
		INSTRUCTION_FILES[ fileType ].fileName
	);
	try {
		return await fs.readFile( bundledPath, 'utf-8' );
	} catch {
		return null;
	}
}

export async function getInstructionFileStatus(
	sitePath: string,
	fileType: InstructionFileType
): Promise< InstructionFileStatus > {
	const config = INSTRUCTION_FILES[ fileType ];
	const filePath = getInstructionFilePath( sitePath, fileType );

	try {
		await fs.access( filePath );

		return {
			id: config.id,
			fileName: config.fileName,
			displayName: config.displayName,
			description: config.description,
			exists: true,
			path: filePath,
		};
	} catch {
		return {
			id: config.id,
			fileName: config.fileName,
			displayName: config.displayName,
			description: config.description,
			exists: false,
			path: filePath,
		};
	}
}

export async function getAllInstructionFilesStatus(
	sitePath: string
): Promise< InstructionFileStatus[] > {
	return Promise.all(
		INSTRUCTION_FILE_TYPES.map( ( fileType ) => getInstructionFileStatus( sitePath, fileType ) )
	);
}

export async function installInstructionFile(
	sitePath: string,
	fileType: InstructionFileType,
	overwrite: boolean
): Promise< { path: string; overwritten: boolean } > {
	const filePath = getInstructionFilePath( sitePath, fileType );
	const bundledContent = await getBundledContent( fileType );

	if ( ! bundledContent ) {
		throw new Error( `Bundled content not found for ${ fileType }` );
	}

	if ( ! overwrite ) {
		if ( await pathExists( filePath ) ) {
			return { path: filePath, overwritten: false };
		}
	}

	await fs.writeFile( filePath, bundledContent, 'utf-8' );
	return { path: filePath, overwritten: overwrite };
}
