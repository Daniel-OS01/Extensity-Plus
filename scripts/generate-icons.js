const fs = require("node:fs");
const path = require("node:path");

const sharp = require("sharp");

const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "images");
const sourcePath = path.join(outputDir, "Extensity-Extension-Manager.png");
const outputSizes = [16, 32, 48, 128];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function renderIcon(size) {
  let pipeline = sharp(sourcePath, { failOn: "error" }).resize(size, size, {
    fit: "fill",
    kernel: sharp.kernel.lanczos3
  });
  if (size <= 48) {
    pipeline = pipeline.sharpen(size === 16 ? 1.2 : size === 32 ? 1 : 0.8);
  }
  const buffer = await pipeline.png({
    compressionLevel: 9,
    palette: false
  }).toBuffer();
  const metadata = await sharp(buffer).metadata();
  assert(metadata.width === size && metadata.height === size, `Generated icon${size}.png has invalid size ${metadata.width}x${metadata.height}.`);
  return buffer;
}

async function main() {
  assert(fs.existsSync(sourcePath), "Missing PNG icon source: images/Extensity-Extension-Manager.png");

  for (const size of outputSizes) {
    const outputPath = path.join(outputDir, `icon${size}.png`);
    fs.writeFileSync(outputPath, await renderIcon(size));
    console.log(`generated ${path.relative(repoRoot, outputPath)}`);
  }

  const toolbarIconPath = path.join(outputDir, "iconbar.png");
  fs.writeFileSync(toolbarIconPath, await renderIcon(128));
  console.log(`generated ${path.relative(repoRoot, toolbarIconPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
