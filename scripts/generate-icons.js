import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const candidateLogoPaths = [
  path.join(projectRoot, "assets", "dermatherapy-logo.jpg"),
  path.join(projectRoot, "assets", "branding", "dermatherapy-logo.png"),
  path.join(projectRoot, "src", "renderer", "public", "dermatherapy-logo.jpg"),
  path.join(projectRoot, "resources", "dermatherapy-logo.jpg")
];

const outputConfigs = [
  { size: 192, outputPath: path.join(projectRoot, "src", "renderer", "public", "icon-192.png") },
  { size: 512, outputPath: path.join(projectRoot, "src", "renderer", "public", "icon-512.png") }
];

function findLogoPath() {
  const logoPath = candidateLogoPaths.find((candidatePath) => fs.existsSync(candidatePath));
  if (!logoPath) {
    throw new Error(
      [
        "Could not find the ClearSkin Hub logo source file.",
        "Checked:",
        ...candidateLogoPaths.map((candidatePath) => `- ${candidatePath}`)
      ].join("\n")
    );
  }

  return logoPath;
}

async function generateIcon(sourcePath, outputPath, size) {
  const logo = sharp(sourcePath).resize({
    width: Math.round(size * 0.78),
    height: Math.round(size * 0.78),
    fit: "inside",
    withoutEnlargement: true
  });

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: "#edf3f6"
    }
  })
    .composite([{ input: await logo.toBuffer(), gravity: "center" }])
    .png()
    .toFile(outputPath);
}

async function main() {
  const sourcePath = findLogoPath();
  for (const config of outputConfigs) {
    await generateIcon(sourcePath, config.outputPath, config.size);
  }

  console.log(`Generated PWA icons from ${sourcePath}`);
  for (const config of outputConfigs) {
    const metadata = await sharp(config.outputPath).metadata();
    console.log(`${path.basename(config.outputPath)}: ${metadata.width}x${metadata.height}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
