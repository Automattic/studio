import { vi } from 'vitest';

export const lock = vi.fn().mockImplementation( ( path, options, callback ) => callback( null ) );
export const unlock = vi.fn().mockImplementation( ( path, callback ) => callback( null ) );

export default {
	lock,
	unlock,
};
