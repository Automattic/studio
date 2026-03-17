import fs from 'fs/promises';
import nodePath from 'path';
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

export async function getInstructionFileStatus(
	sitePath: string,
	fileType: InstructionFileType
): Promise< InstructionFileStatus > {
	const config = INSTRUCTION_FILES[ fileType ];
	const filePath = getInstructionFilePath( sitePath, fileType );
	let exists = false;

	try {
		await fs.access( filePath );
		exists = true;
	} catch {
		// File does not exist
	}

	return {
		id: config.id,
		fileName: config.fileName,
		displayName: config.displayName,
		description: config.description,
		exists,
		path: filePath,
	};
}

export async function getAllInstructionFilesStatus(
	sitePath: string
): Promise< InstructionFileStatus[] > {
	return Promise.all(
		INSTRUCTION_FILE_TYPES.map( ( fileType ) => getInstructionFileStatus( sitePath, fileType ) )
	);
}
