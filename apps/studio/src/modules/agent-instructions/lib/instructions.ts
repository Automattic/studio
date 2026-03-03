import fs from 'fs/promises';
import nodePath from 'path';
import {
	INSTRUCTION_FILES,
	INSTRUCTION_FILE_TYPES,
	type InstructionFileType,
	extractInstructionVersion,
	isInstructionVersionOutdated,
} from '../constants';

export interface InstructionFileStatus {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
	exists: boolean;
	path: string;
	version?: string | null;
	isOutdated?: boolean;
}

export function getInstructionFilePath( sitePath: string, fileType: InstructionFileType ): string {
	return nodePath.join( sitePath, INSTRUCTION_FILES[ fileType ].fileName );
}

export async function getInstructionFileStatus(
	sitePath: string,
	fileType: InstructionFileType
): Promise< InstructionFileStatus > {
	const config = INSTRUCTION_FILES[ fileType ];
	const filePath = getInstructionFilePath( sitePath, fileType );

	try {
		await fs.access( filePath );
		const content = await fs.readFile( filePath, 'utf-8' );
		const version = extractInstructionVersion( content );
		const isOutdated = isInstructionVersionOutdated( version );

		return {
			id: config.id,
			fileName: config.fileName,
			displayName: config.displayName,
			description: config.description,
			exists: true,
			path: filePath,
			version,
			isOutdated,
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
	content: string,
	overwrite: boolean
): Promise< { path: string; overwritten: boolean } > {
	const filePath = getInstructionFilePath( sitePath, fileType );
	let overwritten = false;

	if ( ! overwrite ) {
		try {
			await fs.access( filePath );
			return { path: filePath, overwritten: false };
		} catch {
			// File does not exist, proceed with install.
		}
	} else {
		overwritten = true;
	}

	await fs.writeFile( filePath, content, 'utf-8' );
	return { path: filePath, overwritten };
}

export async function installAllInstructionFiles(
	sitePath: string,
	content: string,
	overwrite: boolean
): Promise< Array< { fileType: InstructionFileType; path: string; overwritten: boolean } > > {
	const results = await Promise.all(
		INSTRUCTION_FILE_TYPES.map( async ( fileType ) => {
			const result = await installInstructionFile( sitePath, fileType, content, overwrite );
			return { fileType, ...result };
		} )
	);
	return results;
}
