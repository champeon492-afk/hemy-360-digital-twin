import { open, writeFile } from 'node:fs/promises';
import { readSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IfcImporter } from '@thatopen/fragments';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/convert-ifc.mjs input.ifc output.frag');
  process.exit(2);
}

const handle = await open(input, 'r');
const importer = new IfcImporter();
importer.wasm = { path: pathToFileURL(resolve('node_modules/web-ifc') + '/').href, absolute: true };
let lastPercent = -1;
try {
  const bytes = await importer.process({
    id: 'SAMPLE',
    readFromCallback: true,
    readCallback(offset, size) {
      const buffer = Buffer.allocUnsafe(size);
      const length = readSync(handle.fd, buffer, 0, size, offset);
      return buffer.subarray(0, length);
    },
    progressCallback(progress, detail) {
      const percent = Math.floor(progress * 100);
      if (percent >= lastPercent + 5 || percent === 100) {
        console.log(`${detail.process}: ${percent}%`);
        lastPercent = percent;
      }
    },
  });
  await writeFile(output, bytes);
  console.log(`Wrote ${bytes.length.toLocaleString()} bytes to ${output}`);
} finally {
  await handle.close();
}
