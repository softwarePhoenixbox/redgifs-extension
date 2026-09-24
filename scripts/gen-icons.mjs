// scripts/gen-icons.mjs
import sharp from 'sharp';

const sizes = [16, 32, 48, 96, 128];
const src = 'assets/icon.png';

await Promise.all(
  sizes.map(size =>
    sharp(src)
      .resize(size, size)
      .toFile(`public/icon/${size}.png`)
  )
);