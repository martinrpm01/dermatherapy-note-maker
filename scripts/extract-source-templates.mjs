import fs from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

function decodeXmlText(xml) {
  return xml
    .replace(/<text:tab\/>/g, " ")
    .replace(/<text:line-break\/>/g, "\n")
    .replace(/<\/text:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    throw new Error("Pass the source .odt directory as the first argument.");
  }

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const odtFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".odt"));
  if (!odtFiles.length) {
    throw new Error(`No .odt files found in ${sourceDir}`);
  }

  const templates = [];
  for (const file of odtFiles) {
    const filePath = path.join(sourceDir, file.name);
    const buffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const content = await zip.file("content.xml")?.async("string");
    if (!content) {
      continue;
    }

    templates.push({
      fileName: file.name,
      extractedText: decodeXmlText(content)
    });
  }

  const outputPath = path.join(process.cwd(), "docs", "source-template-manifest.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        sourceDirectory: path.basename(path.resolve(sourceDir)),
        generatedAt: new Date().toISOString(),
        templates
      },
      null,
      2
    )
  );

  console.log(`Wrote ${templates.length} extracted templates to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
