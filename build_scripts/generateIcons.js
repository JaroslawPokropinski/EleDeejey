/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

async function generateIcons() {
  const assetsPath = path.resolve('assets');
  const iconData = fs.readFileSync(`${assetsPath}/icon.svg`);
  const icon = sharp(iconData);
  const iconSizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

  for (const size of sizes) {
    await icon
      .resize({ width: size, height: size })
      .toFile(`${assetsPath}/icons/${size}x${size}.png`);
  }

  await icon
    .resize({ width: 256, height: 256 })
    .toFile(`${assetsPath}/icon.png`);

  pngToIco(
    await Promise.all(
      iconSizes.map((size) =>
        icon.png({ width: size, height: size }).toBuffer(),
      ),
    ),
  )
    .then((buf) => {
      return fs.writeFileSync(`${assetsPath}/icon.ico`, buf);
    })
    .catch(console.error);
}

generateIcons();
