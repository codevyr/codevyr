// Monaco Editor language support for the user's Pest-based DSL
// ID: 'askl'
import * as monaco from 'monaco-editor';

export function registerAskl(monaco: typeof import('monaco-editor')) {
    const languageId = 'askl';

    // 1) Register the language id
    monaco.languages.register({ id: languageId, extensions: ['.askl'], aliases: ['ASKL', 'askl'] });

    // 2) Language configuration (brackets, comments, auto-closing, folding)
    monaco.languages.setLanguageConfiguration(languageId, {
        comments: {
            blockComment: ['/*', '*/'],
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')'],
        ],
        autoClosingPairs: [
            { open: '"', close: '"' },
            { open: '{', close: '}' },
            { open: '(', close: ')' },
            { open: '[', close: ']' },
        ],
        surroundingPairs: [
            { open: '"', close: '"' },
            { open: '{', close: '}' },
            { open: '(', close: ')' },
            { open: '[', close: ']' },
        ],
        folding: {
            markers: {
                start: /^\s*\{\s*$/,
                end: /^\s*\}\s*$/,
            },
        },
        wordPattern: /(-?\d*\.\d\w*)|([^\`~!@#\$%\^&*\(\)\-=\+\[\{\]\}\\\|;:'",\.<>\/?\s]+)/g,
    });

    // 3) Monarch tokenizer
    // Note: JavaScript regex lacks full Unicode XID support. If you need full XID_START/XID_CONTINUE,
    // consider expanding `identStart/identContinue` using \p{ID_Start}/\p{ID_Continue} and a runtime that supports it.
    const identStart = /[A-Za-z_]/;
    const identContinue = /[A-Za-z0-9_]/;

    monaco.languages.setMonarchTokensProvider(languageId, {
        defaultToken: 'text',
        tokenPostfix: '.askl',

        // Brackets
        brackets: [
            { open: '{', close: '}', token: 'delimiter.bracket' },
            { open: '(', close: ')', token: 'delimiter.parenthesis' },
            { open: '[', close: ']', token: 'delimiter.array' },
        ],

        // Escapes (keep minimal; grammar doesn't define escapes, but highlighting won't hurt)
        escapes: /\\(?:[\\\"nrt])/,

        // Regex pieces
        ident: new RegExp(`${identStart.source}${identContinue.source}*`),

        // Root state
        tokenizer: {
            root: [
                // Whitespace
                { include: '@whitespace' },

                // Comments: /* ... */
                [/\/\*/, 'comment', '@comment'],

                // Delimiters & operators
                [/\{/, 'delimiter.bracket', '@pushScope'],
                [/\}/, 'delimiter.bracket'],
                [/\(/, 'delimiter.parenthesis'],
                [/\)/, 'delimiter.parenthesis'],
                [/[,;=]/, 'delimiter'],

                // Forced verb: !"..."
                [/!\"/, { token: 'keyword', next: '@forcedString' }],

                // Plain filter / quoted_string: "..."
                [/\"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

                // Generic verb: @ident ( ... )?
                [/@ident/, {
                    // If we see an identifier after '@', treat as a verb name
                    cases: {
                        '@default': { token: 'keyword', next: '@maybeCall' },
                    }
                }],

                // Generic identifier (could be a bareword)
                [/@ident/, 'identifier'],
            ],

            // Handle nested scopes for better folding/highlighting of blocks
            pushScope: [
                // Enter a block, and keep tokenizing like root; pop when a matching '}' is found
                { include: 'root' },
                [/\}/, 'delimiter.bracket', '@pop'],
            ],

            // After a @verb: maybe arguments in parens
            maybeCall: [
                { include: '@whitespace' },
                [/\(/, 'delimiter.parenthesis', '@inCall'],
                // No arguments, go back to root
                ['', '', '@pop'],
            ],

            // Inside ( ... ) for verb_arguments (positional, named, or both)
            inCall: [
                { include: '@whitespace' },
                // Named argument: ident = "..."
                [/@ident(?=\s*=)/, 'variable', '@namedArg'],
                // Positional argument: quoted string
                [/\"/, { token: 'string.quote', next: '@string' }],
                [/[,]/, 'delimiter'],
                [/\)/, 'delimiter.parenthesis', '@pop'],
            ],

            namedArg: [
                { include: '@whitespace' },
                [/=/, 'delimiter'],
                { include: '@whitespace' },
                [/\"/, { token: 'string.quote', next: '@string', nextEmbedded: '' }],
                // After string, return to inCall
                ['', '', '@pop'],
            ],

            // Standard string (plain_filter, quoted_string)
            string: [
                [/[^\\\"]+/, 'string'],
                [/@escapes/, 'string.escape'],
                [/\"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
            ],

            // Forced verb string (after !)
            forcedString: [
                [/[^\\\"]+/, 'string'],
                [/@escapes/, 'string.escape'],
                [/\"/, { token: 'string.quote', next: '@pop' }],
            ],

            comment: [
                [/[^\*]+/, 'comment'],
                [/\*\//, 'comment', '@pop'],
                [/\*/, 'comment']
            ],

            whitespace: [
                [/\s+/, 'white'],
            ],

            // Recognize @generic identifiers
            ident: [
                [/@ident/, 'identifier']
            ],
        },
    } as monaco.languages.IMonarchLanguage);

    // 4) Basic autocomplete / snippets
    monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: ['@', '!', '"', '{'],
        provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn
            );

            const suggestions: monaco.languages.CompletionItem[] = [
                {
                    label: '@filter',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: '@filter("${1:pattern}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'generic_verb',
                    range: range,
                },
                {
                    label: '@ignore',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: '@ignore("${1:pattern}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'generic_verb',
                    range: range,
                },
                {
                    label: '@preamble',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: '@preamble',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'generic_verb',
                    range: range,
                },
                {
                    label: 'forced-verb',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: '!"${1:verb}"',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'special_verb (forced_verb)',
                    range: range,
                },
                {
                    label: 'scope',
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: '{\n\t$0\n}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'scope block',
                    range: range,
                },
            ];

            return { suggestions };
        },
    });

    // 5) Simple hover provider for quick grammar hints
    monaco.languages.registerHoverProvider(languageId, {
        provideHover: (model, position) => {
            const word = model.getWordAtPosition(position);
            if (!word) return null;
            if (word.word.startsWith('@')) {
                return {
                    contents: [
                        { value: '**generic_verb**' },
                        { value: 'Form: `@ident` or `@ident("positional", key="value")`' },
                    ],
                };
            }
            if (word.word === '!') {
                return { contents: [{ value: '**forced_verb**: `!"verb"`' }] };
            }
            return null;
        },
    });

    // 6) Basic document formatting (very lightweight): just trims trailing spaces
    monaco.languages.registerDocumentFormattingEditProvider(languageId, {
        provideDocumentFormattingEdits(model) {
            const edits: monaco.languages.TextEdit[] = [];
            const lineCount = model.getLineCount();
            for (let i = 1; i <= lineCount; i++) {
                const line = model.getLineContent(i);
                const trimmed = line.replace(/\s+$/g, '');
                if (trimmed !== line) {
                    edits.push({
                        range: new monaco.Range(i, 1, i, line.length + 1),
                        text: trimmed,
                    });
                }
            }
            return edits;
        },
    });
}
