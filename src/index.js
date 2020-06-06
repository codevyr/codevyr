"use strict";

import _ from 'lodash';
import $ from 'jquery';
import GoldenLayout from 'golden-layout';
import * as monaco from 'monaco-editor';
import ApolloClient from 'apollo-boost';

import cytoscape from "cytoscape";

import { gql } from "apollo-boost";

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
                type: 'stack',
                id: 'codeViewer',
            }]
        }, {
            type: 'component',
            componentName: 'cfgViewer',
            componentState: { label: 'D'}
        }]
    }]
};

var layout = new GoldenLayout(config);
require("golden-layout/src/css/goldenlayout-base.css");
require("golden-layout/src/css/goldenlayout-light-theme.css");

const graphqlClient = new ApolloClient({
  uri: window.location.origin + '/graphql'
});

const codeViewer = {
    uri: window.location.origin + '/source',
    openFiles: new Map(),

    getFile: function(filename) {
        return $.post(this.uri + '/get', {
            filename: filename
        });
    },

    openFile: function(filename, start, end) {
        if (this.openFiles.has(filename)) {
            var item = layout.root.getItemsById(filename)[0];
            layout.root
                .getItemsById('codeViewer')[0]
                .setActiveContentItem(item);
            this.openFiles.get(filename).revealLines(start, end);
        } else {
            this.getFile(filename)
                .done($.proxy(function(data) {
                    layout.root
                        .getItemsById('codeViewer')[0]
                        .addChild({
                            type: 'component',
                            componentName: 'codeViewer',
                            componentState: {
                                ...data,
                                start: start,
                                end: end
                            },
                            id: filename
                        });
                }, this))
                .fail(function(err) {
                    console.log('Failed to fetch the file', err);
                });
        }
    }
};

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
    },

    sendQuery: function() {
        var query = this.getText();
        console.log(query);
        graphqlClient
            .query({
                query: gql(query),
            })
            .then(result => {
                console.log(result);
                // cfgViewer.testSvg();
                cfgViewer.updateCfg(result.data);
            });
    }
};

var cfgViewer = {
    name: 'cfgViwer',
    id: 'cfg-viewer',

    jq: function() {
        return $('#' + this.id);
    },

    _getLinksNodes: function(data, links, nodes) {
        if (data["name"] !== undefined) {
            var node_to = data["name"];

            nodes.add({
                name: data["name"],
                filename: data["filename"],
                start: data['range']['start']['line'],
                end: data['range']['end']['line']
            });

            if (data["parents"] !== undefined) {
                _.map(data["parents"], _.bind(function(elem) {
                    var node_from = elem["name"];

                    links.add({
                        source: node_from,
                        target: node_to,
                    });
                    this._getLinksNodes(elem, links, nodes);
                }, this));
            }
        } else {
            _.map(data, _.bind(this._getLinksNodes, this, _, links, nodes));
        }

        return [links, nodes];
    },

    getLinksNodes: function(data) {
        var [links, nodes] = this._getLinksNodes(data, new Set(), new Set());
        return [Array.from(links), Array.from(nodes)];
    },

    /**
     * Finds the root (the topmost) element of the request.
     */
    getRoot: function(data) {
        if (data["name"] !== undefined) {
            return data["name"];
        } else {
            return _.transform(data, _.bind(function(res, o) {
                var root = this.getRoot(o);
                if (root != undefined) {
                    res.push(root);
                    return false;
                };
                return true;
            }, this), [undefined]).slice(-1)[0];
        }
    },

    updateCfg: function(data) {
        // const links = data.links.map(d => Object.create(d));
        // const nodes = data.nodes.map(d => Object.create(d));

        var [links, nodes] = this.getLinksNodes(data);

        var root = this.getRoot(data);

        this.jq().css({
            width: 600,
            height: 600,
            display: "block"
        });

        console.log(links, nodes, root);
        var cy = cytoscape({
            container: this.jq(),
            elements: [
                ...nodes.map(function(n) {
                    return {
                        group: 'nodes',
                        data: {
                            id: n.name,
                            symbol: n
                        }
                    };
                }),
                ...links.map(function(l) {
                    return {
                        group: 'edges',
                        data: {
                            id: l.source + '-' + l.target,
                            source: l.source,
                            target: l.target
                        }
                    };
                })
            ],
            style: [ // the stylesheet for the graph
                {
                    selector: 'node',
                    style: {
                        'background-color': '#666',
                        'label': 'data(id)'
                    }
                },

                {
                    selector: 'edge',
                    style: {
                        'width': 3,
                        'line-color': '#bbb',
                        'target-arrow-color': '#555',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier'
                    }
                }
            ],

            layout: {
                name: 'breadthfirst',
                rows: true,
                avoidOverlap: true,
                maximal: true,
                roots: [root],
                nodeDimensionsIncludeLabels: true,
                transform: (node, pos) => ({x: pos.x, y: -pos.y}),
            }
        });

        cy.nodes().on('tap', function(evt) {
            var node = evt.target;
            var symbol = node.data("symbol");
            console.log('node', symbol);

            codeViewer.openFile(symbol.filename, symbol.start, symbol.end);
        });

        cy.edges().on('tap', function(evt) {
            var edge = evt.target;
            console.log('edge', edge);
        });
    }
};

layout.registerComponent('queryEditor', function(container, componentState) {
    var editor = monaco.editor.create(container.getElement()[0], {
        value: [
            'test',
        ].join('\n'),
        language: 'graphql',
        automaticLayout: true
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
            queryEditor.sendQuery();
        }
    });

    queryEditor.setEditor(editor);
});
layout.registerComponent('codeViewer', function(container, componentState) {
    container.setTitle(componentState.filename);
    var editor = monaco.editor.create(container.getElement()[0], {
        language: componentState.language,
        automaticLayout: true,
        value: componentState.contents
    });
    editor.revealLines(componentState.start, componentState.end);
    console.log('set the editor the file', componentState);
    codeViewer.openFiles.set(componentState.filename, editor);
});
layout.registerComponent('cfgViewer', function(container, componentState) {
    container.getElement().html('<div id="' + cfgViewer.id + '"></div>');
});
layout.registerComponent('testComponent', function(container, componentState) {
    container.getElement().html('<h2>' + componentState.label + '</h2>');
});

layout.init();

