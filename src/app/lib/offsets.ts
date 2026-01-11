export type OffsetValue = number | string | null | undefined;

export type OffsetLocation = {
  lineNumber: number;
  column: number;
};

function clampOffset(offset: number): number {
  return offset < 0 ? 0 : offset;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

export function parseOffset(value: OffsetValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampOffset(Math.floor(value));
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return clampOffset(parsed);
    }
  }

  return null;
}

export function getLineColumnFromOffset(content: string, offsetValue: OffsetValue): OffsetLocation | null {
  const offset = parseOffset(offsetValue);
  if (offset === null) {
    return null;
  }

  if (offset <= 0) {
    return { lineNumber: 1, column: 1 };
  }

  let byteCount = 0;
  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < content.length; ) {
    const codePoint = content.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    const byteLength = utf8ByteLength(codePoint);

    if (byteCount + byteLength > offset) {
      return { lineNumber, column };
    }

    byteCount += byteLength;

    if (codePoint === 10) {
      lineNumber += 1;
      column = 1;
    } else {
      column += codeUnitLength;
    }

    index += codeUnitLength;
  }

  return { lineNumber, column };
}

export function formatOffsetLocation(content: string | undefined, offsetValue: OffsetValue): string {
  if (content) {
    const location = getLineColumnFromOffset(content, offsetValue);
    if (location) {
      return `${location.lineNumber}:${location.column}`;
    }
  }

  const parsed = parseOffset(offsetValue);
  if (parsed === null) {
    return 'unknown';
  }

  return `@${parsed}`;
}
