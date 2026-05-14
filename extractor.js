import fs from 'fs/promises';

/**
 * Extracts the largest embedded JPEG from a RAW file (NEF, CR2, etc.)
 * This is a robust, "in-app" way to convert RAW to JPEG without external codecs.
 */
export async function extractEmbeddedJpeg(inputPath, outputPath) {
  const buffer = await fs.readFile(inputPath);
  let bestStart = -1;
  let bestEnd = -1;
  let maxLen = 0;

  // Scan for all JPEG Start-Of-Image markers
  for (let i = 0; i < buffer.length - 1000; i++) {
    if (buffer[i] === 0xFF && buffer[i+1] === 0xD8) {
      // For each SOI, find the LAST EOI (FF D9) in the file to catch the largest possible block
      // Most RAW files have the full-res preview as a single large block
      for (let j = buffer.length - 2; j > i + 1000; j--) {
        if (buffer[j] === 0xFF && buffer[j+1] === 0xD9) {
          const currentLen = j + 2 - i;
          // Most full-res previews are at least 1MB
          if (currentLen > maxLen && currentLen > 500000) { 
            maxLen = currentLen;
            bestStart = i;
            bestEnd = j + 2;
            break; // Found the largest for this SOI
          }
        }
      }
    }
  }

  if (bestStart !== -1) {
    await fs.writeFile(outputPath, buffer.subarray(bestStart, bestEnd));
    return true;
  }
  return false;
}
