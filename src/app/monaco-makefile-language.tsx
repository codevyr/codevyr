export function registerMakefile(monaco: typeof import('monaco-editor')) {
  const languageId = 'makefile';
  const existing = monaco.languages.getLanguages().some((language) => language.id === languageId);
  if (existing) {
    return;
  }

  monaco.languages.register({
    id: languageId,
    extensions: ['.mk', '.mak'],
    filenames: ['Makefile', 'makefile', 'GNUmakefile'],
    aliases: ['Makefile', 'make'],
  });

  monaco.languages.setLanguageConfiguration(languageId, {
    comments: {
      lineComment: '#',
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  monaco.languages.setMonarchTokensProvider(languageId, {
    defaultToken: '',
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^\t.+$/, 'string'],
        [/^[^:=\s]+(?=\s*:)/, 'type.identifier'],
        [/\$\(.*?\)/, 'variable'],
        [/\${.*?}/, 'variable'],
        [/".*?"/, 'string'],
        [/'.*?'/, 'string'],
        [/[=:+?]/, 'operator'],
      ],
    },
  });
}
