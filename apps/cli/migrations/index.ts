import { checkStudioCompatibilityForInitialMigration } from './00-check-studio-compatibility';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [ checkStudioCompatibilityForInitialMigration ];
