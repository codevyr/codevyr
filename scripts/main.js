"use strict";

var config = {
    content: [{
        type: 'row',
        content: [{
            type: 'component',
            componentName: 'queryEditor',
            componentState: { label: 'A'}

        }, {
            type: 'column',
            content: [{
                type: 'component',
                componentName: 'testComponent',
                componentState: {
                    label: 'B'
                }
            }, {
                type: 'component',
                componentName: 'testComponent',
                componentState: {
                    label: 'C'
                }
            }]
        }, {
            type: 'component',
            componentName: 'testComponent',
            componentState: { label: 'D'}
        }]
    }]
};

var layout = new GoldenLayout(config);

var queryEditor = {
    _editor: null,

    setEditor: function(editor) {
        console.log("Hello world" + editor);
        this._editor = editor;
    },

    getText: function() {
        console.log("Hello world" + this._editor);
        if (this._editor === null) {
            console.log("Hello world");
            return "sthsthsthsht";
        }

        console.log("Hello sths world");
        return this._editor.getValue();
    }
};

layout.registerComponent('queryEditor', function(container, componentState) {
    container.getElement().html('<div id="query-editor-container" style="width:100%;height:50%;border:1px solid grey"></div>'+
                                '<p id="query-editor-container-text">' +
                                                            queryEditor.getText() +
                                                            '</p>' );

    require.config({paths: {'vs': '../node_modules/monaco-editor/min/vs'}});

    require(['vs/editor/editor.main'], function() {
        var editor = monaco.editor.create(document.getElementById('query-editor-container'), {
            value: [
                'test',
            ].join('\n'),
            language: 'graphql'
        });

        editor.addAction({
            id: 'sendQuery',
            label: 'Send query',

            keybindings: [
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
            ],

            precondition: null,
            keybindingContext: null,
            contextMenuGroupId: 'commands',

            contextMenuOrder: 1.5,

            run: function(ed) {
                $("#query-editor-container-text").text(queryEditor.getText());
                return null;
            }
        });

        queryEditor.setEditor(editor);
    });

});
layout.registerComponent('testComponent', function(container, componentState) {
    container.getElement().html('<h2>' + componentState.label + '</h2>');
});

layout.init();

