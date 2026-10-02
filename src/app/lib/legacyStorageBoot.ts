// Imported first by main.tsx: ES imports are hoisted, so a call placed in main.tsx itself would run
// after the other modules had already read storage. Importing this module first moves any
// pre-MusiLynk keys before they do.
import { migrateLegacyStorage } from './legacyStorage';

migrateLegacyStorage();
