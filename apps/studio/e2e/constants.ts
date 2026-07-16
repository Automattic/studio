import path from 'path';

export const DEFAULT_SITE_NAME = 'My WordPress Website';

// apps/studio/e2e/ up to the repo root, where test-fixtures/ lives.
export const REPO_ROOT = path.resolve( __dirname, '..', '..', '..' );
export const BACKUP_FIXTURES_DIR = path.join( REPO_ROOT, 'test-fixtures', 'backups' );
// Data-heavy artifacts fetched by `npm run e2e:fixtures` (see test-fixtures/readme.md).
export const DOWNLOADED_FIXTURES_DIR = path.join( REPO_ROOT, 'test-fixtures', 'downloads' );
