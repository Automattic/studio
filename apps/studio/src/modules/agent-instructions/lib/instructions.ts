import {
	getAllInstructionFilesStatus,
	getInstructionFilePath,
	getInstructionFileStatus,
	installInstructionFile as installInstructionFileShared,
	removeInstructionFile,
} from '@studio/common/lib/agent-instructions';
import { getAiInstructionsPath } from 'src/lib/server-files-paths';
import type { InstructionFileType } from '../constants';

export type { InstructionFileStatus } from '@studio/common/lib/agent-instructions';
export { getAllInstructionFilesStatus, getInstructionFilePath, getInstructionFileStatus };

export async function installInstructionFile(
	sitePath: string,
	fileType: InstructionFileType,
	overwrite: boolean
): Promise< { path: string; overwritten: boolean } > {
	return installInstructionFileShared( sitePath, fileType, getAiInstructionsPath(), overwrite );
}

export { removeInstructionFile };
