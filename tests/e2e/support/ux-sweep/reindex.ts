import { writeIndex } from './capture';
import { indexExtra } from './index-extra';

// Rebuilds index.json from the saved results without taking any screenshots:
//   npx tsx tests/e2e/support/ux-sweep/reindex.ts
writeIndex(indexExtra());
