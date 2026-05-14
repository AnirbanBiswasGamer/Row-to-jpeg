const MIN_EMBEDDED_JPEG_SIZE_BYTES = 64 * 1024;

/**
 * Extracts the largest embedded JPEG from a RAW file (NEF, CR2, etc.)
 * This is a robust, "in-app" way to convert RAW to JPEG without external codecs.
 */
export function extractEmbeddedJpeg(buffer) {
  return findLargestEmbeddedJpeg(buffer);
}

function findLargestEmbeddedJpeg(buffer) {
  let bestJpeg = null;

  for (let start = 0; start < buffer.length - 1; start += 1) {
    if (buffer[start] !== 0xFF || buffer[start + 1] !== 0xD8) continue;

    const end = findJpegEnd(buffer, start);
    if (end === -1) continue;

    const candidate = buffer.subarray(start, end);
    if (candidate.length < MIN_EMBEDDED_JPEG_SIZE_BYTES) continue;

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
      offset = markerOffset + 1;

      if (offset + 2 >= buffer.length) return -1;

      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) return -1;
      offset += segmentLength;

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

    if (markerOffset + 2 >= buffer.length) return -1;
    const segmentLength = buffer.readUInt16BE(markerOffset + 1);
    if (segmentLength < 2) return -1;

    offset = markerOffset + 1 + segmentLength;
  }

  return -1;
}
