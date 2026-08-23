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
            lineComment: '//',
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
        wordPattern: /(-?\d*\.\d\w*)|(@@?[A-Za-z_]\w*)|(\#[A-Za-z_]\w*)|([^\`~!@#\$%\^&*\(\)\-=\+\[\{\]\}\\\|;:'",\.<>\/?\s]+)/g,
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

                // Comments: // ... and /* ... */
                [/\/\/.*$/, 'comment'],
                [/\/\*/, 'comment', '@comment'],

                // Delimiters & operators
                [/\{/, 'delimiter.bracket', '@pushScope'],
                [/\}/, 'delimiter.bracket'],
                [/\(/, 'delimiter.parenthesis'],
                [/\)/, 'delimiter.parenthesis'],
                [/[,;=]/, 'delimiter'],

                // Forced verb: !"..."
                [/!\"/, { token: 'keyword', next: '@forcedString' }],

                // Typed string prefixes glued to the opening quote: g"..." is
                // a glob pattern; re"..." is reserved; anything else is
                // rejected by the parser. Must precede the verb-name rule so
                // e.g. file"..." highlights as an invalid prefix, not a verb.
                [/g(?=\")/, 'type'],
                [/[a-zA-Z]+(?=\")/, 'invalid'],

                // Plain filter / quoted_string: "..."
                [/\"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

                // Inherit label shortcut: @@ident
                [/@@[a-zA-Z_]\w*/, { token: 'keyword', next: '@maybeCall' }],

                // Label shortcut: @ident
                [/@[a-zA-Z_]\w*/, { token: 'keyword', next: '@maybeCall' }],

                // Use shortcut: #ident
                [/#[a-zA-Z_]\w*/, { token: 'keyword', next: '@maybeCall' }],

                // Boolean operators over predicate verbs (guarded by \b like
                // the grammar's !XID_CONTINUE, so `order` stays an ident)
                [/(?:or|and|not)\b/, 'keyword.operator'],

                // Known verb names (without @)
                [/(?:func|file|mod|dir|type|data|macro|field|method|select|filter|ignore|package|project|forced|label|use|preamble|has|refs|derive|unnest|any|loc|search|layer|ephemeral_symbol|ephemeral_instance|ephemeral_ref)\b/, {
                    token: 'keyword', next: '@maybeCall',
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
                // Named argument: ident = <value>
                [/@ident(?=\s*=)/, 'variable', '@namedArg'],
                // Booleans before the generic ident rule, and guarded by \b
                // like the grammar's !XID_CONTINUE, so `trueish` is not a
                // keyword followed by junk.
                [/(?:true|false)\b/, 'keyword'],
                // 64-bit integer literal, optional sign
                [/-?\d+/, 'number'],
                // Typed string prefixes: g"..." glob, others invalid
                [/g(?=\")/, 'type'],
                [/[a-zA-Z]+(?=\")/, 'invalid'],
                // Positional argument: quoted string
                [/\"/, { token: 'string.quote', next: '@string' }],
                [/[,]/, 'delimiter'],
                [/\)/, 'delimiter.parenthesis', '@pop'],
            ],

            namedArg: [
                { include: '@whitespace' },
                [/=/, 'delimiter'],
                { include: '@whitespace' },
                // Primitive literals (see inCall)
                [/(?:true|false)\b/, { token: 'keyword', next: '@pop' }],
                [/-?\d+/, { token: 'number', next: '@pop' }],
                // Typed string prefixes: g"..." glob, others invalid
                [/g(?=\")/, 'type'],
                [/[a-zA-Z]+(?=\")/, 'invalid'],
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

            // Recognize generic identifiers
            ident: [
                [/@ident/, 'identifier']
            ],
        },
    } as monaco.languages.IMonarchLanguage);

    // 4) Basic autocomplete / snippets
    monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: ['@', '!', '"', '{', '#'],
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
                    label: 'filter',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'filter("${1:pattern}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'verb',
                    range: range,
                },
                {
                    label: 'ignore',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'ignore("${1:pattern}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'verb (alias: `not "pattern"`)',
                    range: range,
                },
                {
                    label: 'package',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'package("${1:path}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'filter: symbols under a package path',
                    range: range,
                },
                {
                    label: 'or',
                    kind: monaco.languages.CompletionItemKind.Operator,
                    insertText: 'or ',
                    detail: 'operator: disjoin filters of one dimension, or anchors into one branch',
                    range: range,
                },
                {
                    label: 'and',
                    kind: monaco.languages.CompletionItemKind.Operator,
                    insertText: 'and ',
                    detail: 'operator: conjoin within an expression (binds tighter than `or`)',
                    range: range,
                },
                {
                    label: 'not',
                    kind: monaco.languages.CompletionItemKind.Operator,
                    insertText: 'not ',
                    detail: 'operator: exclude (accumulates and inherits, like ignore)',
                    range: range,
                },
                {
                    label: 'preamble',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'preamble',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'verb',
                    range: range,
                },
                {
                    label: 'project',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'project("${1:name}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'verb',
                    range: range,
                },
                {
                    label: 'label',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'label("${1:name}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'verb',
                    range: range,
                },
                {
                    label: 'use',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'use("${1:name}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'verb',
                    range: range,
                },
                {
                    label: '@name — label shortcut',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: '@${1:name}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'shortcut for label("name")',
                    range: range,
                },
                {
                    label: '@@name — inherit label shortcut',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: '@@${1:name}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'shortcut for label("name", inherit=true)',
                    range: range,
                },
                {
                    label: '#name — use shortcut',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: '#${1:name}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'shortcut for use("name")',
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
                    label: 'g"pattern" — glob string',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: 'g"${1:pattern*}"',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'glob pattern: * matches any run of characters; smart case',
                    range: range,
                },
                {
                    label: 'field',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'field("${1:name}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'selector: struct field / dispatch point',
                    range: range,
                },
                {
                    label: 'method',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'method("${1:name}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'selector: interface method (alias for field)',
                    range: range,
                },
                {
                    label: 'unnest',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'unnest',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'modifier: include transitive children/refs and all containment levels',
                    range: range,
                },
                {
                    label: 'any',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'any',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'type verb constraining no type: replaces an inherited type filter',
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
                {
                    label: 'loc',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'loc("${1:file}", ${2:1})',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'selector: synthetic anchor for a source location',
                    range: range,
                },
                {
                    label: 'search',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'search("${1:query}")',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: 'selector: full-text search over indexed source content (literal, no regex)',
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
            if (word.word.startsWith('@@')) {
                return {
                    contents: [
                        { value: '**inherit label shortcut**' },
                        { value: '`@@name` is shorthand for `label("name", inherit=true)`' },
                    ],
                };
            }
            if (word.word.startsWith('@')) {
                return {
                    contents: [
                        { value: '**label shortcut**' },
                        { value: '`@name` is shorthand for `label("name")`' },
                    ],
                };
            }
            if (word.word.startsWith('#')) {
                return {
                    contents: [
                        { value: '**use shortcut**' },
                        { value: '`#name` is shorthand for `use("name")`' },
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
