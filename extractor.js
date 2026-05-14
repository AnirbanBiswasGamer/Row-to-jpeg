const MIN_EMBEDDED_JPEG_SIZE_64KB = 64 * 1024;
const JPEG_SOI_MARKER = Buffer.from([0xFF, 0xD8]);

/**
 * Extracts the largest embedded JPEG from a RAW file (NEF, CR2, etc.)
 * This is a robust, "in-app" way to convert RAW to JPEG without external codecs.
 */
export function extractEmbeddedJpeg(buffer) {
  return findLargestEmbeddedJpeg(buffer);
}

function findLargestEmbeddedJpeg(buffer) {
  let bestJpeg = null;

  for (let start = buffer.indexOf(JPEG_SOI_MARKER); start !== -1; start = buffer.indexOf(JPEG_SOI_MARKER, start + 2)) {
    const end = findJpegEnd(buffer, start);
    if (end === -1) continue;

    const candidate = buffer.subarray(start, end);
    if (candidate.length < MIN_EMBEDDED_JPEG_SIZE_64KB) continue;

    if (!bestJpeg || candidate.length > bestJpeg.length) {
      bestJpeg = candidate;
    }
  }

  return bestJpeg;
}

function findJpegEnd(buffer, start) {
  let offset = start + 2;

  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xFF) {
      offset += 1;
      continue;
    }

    let markerOffset = offset + 1;
    while (markerOffset < buffer.length && buffer[markerOffset] === 0xFF) {
      markerOffset += 1;
    }

    if (markerOffset >= buffer.length) return -1;

    const marker = buffer[markerOffset];

    if (marker === 0x00) {
      offset = markerOffset + 1;
      continue;
    }

    if (marker === 0xD9) {
      return markerOffset + 1;
    }

    if (marker >= 0xD0 && marker <= 0xD7) {
      offset = markerOffset + 1;
      continue;
    }

    if (marker === 0x01) {
      offset = markerOffset + 1;
      continue;
    }

    if (marker === 0xDA) {
      const segmentLengthOffset = markerOffset + 1;

      if (segmentLengthOffset + 2 > buffer.length) return -1;

      const segmentLength = buffer.readUInt16BE(segmentLengthOffset);
      if (segmentLength < 2 || segmentLengthOffset + segmentLength > buffer.length) return -1;
      offset = segmentLengthOffset + segmentLength;

      while (offset < buffer.length - 1) {
        if (buffer[offset] !== 0xFF) {
          offset += 1;
          continue;
        }

        const nextByte = buffer[offset + 1];
        if (nextByte === 0x00 || (nextByte >= 0xD0 && nextByte <= 0xD7)) {
          offset += 2;
          continue;
        }

        if (nextByte === 0xD9) {
          return offset + 2;
        }

        break;
      }

      continue;
    }

    if (markerOffset + 3 > buffer.length) return -1;
    const segmentLengthOffset = markerOffset + 1;
    const segmentLength = buffer.readUInt16BE(segmentLengthOffset);
    if (segmentLength < 2 || segmentLengthOffset + segmentLength > buffer.length) return -1;

    offset = segmentLengthOffset + segmentLength;
  }

  return -1;
}
