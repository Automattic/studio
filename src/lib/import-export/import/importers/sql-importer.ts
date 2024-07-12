import { BackupContents } from '../types';
import { DefaultImporter } from './Importer';

export class SqlImporter extends DefaultImporter {
	constructor( backup: BackupContents ) {
		super( backup );
	}
}
