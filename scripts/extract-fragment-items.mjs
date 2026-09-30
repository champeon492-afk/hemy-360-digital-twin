import { readFile, writeFile } from 'node:fs/promises';
import { SingleThreadedFragmentsModel } from '@thatopen/fragments';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/extract-fragment-items.mjs input.frag output.json');
  process.exit(2);
}

const bytes = await readFile(input);
const model = new SingleThreadedFragmentsModel('model', bytes);
try {
  const ids = model.getItemsIdsWithGeometry();
  const items = model.getItemsData(ids);
  const positions = model.getPositions(ids);
  const records = [];
  for (let i = 0; i < ids.length; i++) {
    const item = items[i];
    const guid = item?._guid?.value;
    const category = item?._category?.value;
    const position = positions[i];
    if (!guid || !category || !position || category === 'IFCSPACE' || category === 'IFCOPENINGELEMENT') continue;
    records.push({ guid, category, name: item.Name?.value || category, position });
  }
  await writeFile(output, JSON.stringify(records));
  console.log(`Indexed ${records.length.toLocaleString()} renderable IFC items`);
} finally {
  model.dispose();
}
