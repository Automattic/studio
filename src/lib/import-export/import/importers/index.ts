import { BackupContents } from '../types';
import { Importer } from './Importer';
import { JetpackImporter } from './jetpack-importer';
import { SqlImporter } from './sql-importer';

export * from './Importer';
export * from './jetpack-importer';
export * from './sql-importer';

export const allImporters: { [ key: string ]: new ( contents: BackupContents ) => Importer } = {
	JetpackValidator: JetpackImporter,
	SqlValidator: SqlImporter,
};
