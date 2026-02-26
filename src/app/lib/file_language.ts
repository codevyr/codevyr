type LanguageMap = Record<string, string>;

const mimeToLanguage: LanguageMap = {
  'text/x-makefile': 'makefile',
  'text/x-shellscript': 'shell',
  'text/css': 'css',
  'text/html': 'html',
  'text/javascript': 'javascript',
  'application/json': 'json',
  'text/markdown': 'markdown',
  'text/x-python': 'python',
  'text/x-ruby': 'ruby',
  'application/x-yaml': 'yaml',
  'text/x-go': 'go',
  'text/plain': 'plaintext',
};

const extensionToLanguage: LanguageMap = {
  '.bash': 'shell',
  '.c': 'c',
  '.css': 'css',
  '.go': 'go',
  '.h': 'c',
  '.html': 'html',
  '.js': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.mod': 'plaintext',
  '.mk': 'makefile',
  '.proto': 'plaintext',
  '.py': 'python',
  '.rb': 'ruby',
  '.sh': 'shell',
  '.sql': 'sql',
  '.sum': 'plaintext',
  '.toml': 'plaintext',
  '.ts': 'typescript',
  '.txt': 'plaintext',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell',
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function hasMakefileName(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments[segments.length - 1] ?? '';
  return basename.toLowerCase() === 'makefile';
}

export function resolveEditorLanguage(filePath?: string | null, fileType?: string | null): string {
  if (fileType) {
    const normalized = normalize(fileType);
    if (normalized.startsWith('.')) {
      const extensionLanguage = extensionToLanguage[normalized];
      if (extensionLanguage) {
        return extensionLanguage;
      }
    } else {
      const mimeLanguage = mimeToLanguage[normalized];
      if (mimeLanguage) {
        return mimeLanguage;
      }
    }
  }

  if (filePath) {
    if (hasMakefileName(filePath)) {
      return 'makefile';
    }
    const normalizedPath = filePath.toLowerCase();
    const lastDot = normalizedPath.lastIndexOf('.');
    if (lastDot !== -1) {
      const extension = normalizedPath.slice(lastDot);
      const extensionLanguage = extensionToLanguage[extension];
      if (extensionLanguage) {
        return extensionLanguage;
      }
    }
  }

  return 'plaintext';
}
