import { z } from 'zod';

export type RawDirectoryEntry = {
	name: string;
	isDirectory: boolean;
	isSymlink?: boolean;
	path: string;
	children?: RawDirectoryEntry[];
};

export const backupLsItemSchema = z.object( {
	type: z.string(),
	has_children: z.boolean().optional(),
	period: z.string().optional(),
	id: z.string(),
	manifest_path: z.string().optional(),
} );
