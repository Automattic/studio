import { AI_INSTRUCTIONS_MANIFEST } from '../ai-instructions';

export const AGENTS_MD_FILE_NAME = 'AGENTS.md';
export const STUDIO_MD_FILE_NAME = 'STUDIO.md';

/**
 * Content of the AGENTS.md file (thin pointer to STUDIO.md).
 */
export const AGENTS_MD_TEMPLATE = AI_INSTRUCTIONS_MANIFEST.instructions.find(
	( f ) => f.id === 'agents'
)!.content;

/**
 * Content of the STUDIO.md file (detailed Studio instructions).
 */
export const STUDIO_MD_TEMPLATE = AI_INSTRUCTIONS_MANIFEST.instructions.find(
	( f ) => f.id === 'studio'
)!.content;
