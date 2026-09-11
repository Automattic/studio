import fs from 'fs/promises';
import path from 'path';
import { pathExists } from './fs-utils';

export type InstructionFileType = 'agents' | 'claude' | 'studio';

export interface InstructionFileConfig {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
}

export const INSTRUCTION_FILES: Record< InstructionFileType, InstructionFileConfig > = {
	agents: {
		id: 'agents',
		fileName: 'AGENTS.md',
		displayName: 'AGENTS.md',
		description: 'Instructions for Codex, Goose, and other AI agents',
	},
	claude: {
		id: 'claude',
		fileName: 'CLAUDE.md',
		displayName: 'CLAUDE.md',
		description: 'Reference for Claude Code to read AGENTS.md',
	},
	studio: {
		id: 'studio',
		fileName: 'STUDIO.md',
		displayName: 'STUDIO.md',
		description: 'Detailed Studio-specific WordPress development instructions',
	},
};

export const INSTRUCTION_FILE_TYPES: InstructionFileType[] = [ 'agents', 'claude', 'studio' ];

export interface InstructionFileStatus {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
	exists: boolean;
	path: string;
}

export function getInstructionFilePath( sitePath: string, fileType: InstructionFileType ): string {
	return path.join( sitePath, INSTRUCTION_FILES[ fileType ].fileName );
}

async function getBundledContent(
	bundledPath: string,
	fileType: InstructionFileType
): Promise< string | null > {
	const source = path.join( bundledPath, INSTRUCTION_FILES[ fileType ].fileName );
	try {
		return await fs.readFile( source, 'utf-8' );
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

	const exists = await pathExists( filePath );

	return {
		...config,
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

export async function installInstructionFile(
	sitePath: string,
	fileType: InstructionFileType,
	bundledPath: string,
	overwrite: boolean
): Promise< { path: string; overwritten: boolean } > {
	const filePath = getInstructionFilePath( sitePath, fileType );
	const bundledContent = await getBundledContent( bundledPath, fileType );

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

export async function removeInstructionFile(
	sitePath: string,
	fileType: InstructionFileType
): Promise< void > {
	const filePath = getInstructionFilePath( sitePath, fileType );
	await fs.rm( filePath, { force: true } );
}
