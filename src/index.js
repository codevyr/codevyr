"use strict";

import _ from 'lodash';
import $ from 'jquery';
import GoldenLayout from 'golden-layout';
import * as monaco from 'monaco-editor';
import ApolloClient from 'apollo-boost';
import * as d3 from "d3";

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

function linkArc(d) {
  const r = Math.hypot(d.target.x - d.source.x, d.target.y - d.source.y);
  return `
    M${d.source.x},${d.source.y}
    A${r},${r} 0 0,1 ${d.target.x},${d.target.y}
  `;
}

var drag = simulation => {

    function dragstarted(d) {
        if (!d3.event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(d) {
        d.fx = d3.event.x;
        d.fy = d3.event.y;
    }

    function dragended(d) {
        if (!d3.event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
}

var cfgViewer = {
    name: 'cfgViwer',
    id: 'cfg-viewer',

    jq: function() {
        return $('#' + this.id);
    },

    getLinks: function(data, links) {
        if (data["name"] !== undefined) {
            var node_to = data["name"];

            if (data["parents"] !== undefined) {
                _.map(data["parents"], _.bind(function(elem) {
                    var node_from = elem["name"];

                    links.add({
                        source: node_from,
                        target: node_to,
                    });
                    this.getLinks(elem, links);
                }, this));
            }
        } else {
            _.map(data, _.bind(this.getLinks, this, _, links));
        }

        return links;
    },

    updateCfg: function(data) {
        // const links = data.links.map(d => Object.create(d));
        // const nodes = data.nodes.map(d => Object.create(d));

        var links = Array.from(this.getLinks(data, new Set())).map(function(l) { return {source: l.source, target: l.target}; });;

        var nodes = Array.from(new Set([...links.map(l => l.source), ...links.map(l => l.target)])).map(i => {return {id: i};});

        console.log(links, nodes);

        var width = 600,
            height = 600;

        d3.select('#' + this.id).selectAll('svg').remove();

        var svg = d3
            .select('#' + this.id)
            .append("svg:svg")
            .attr('width', width)
            .attr('height', height);
        var g = svg
            .append("g")
            .attr("transform", "translate(" + width / 2 + "," + height / 2 + ")");

        var simulation = d3.forceSimulation(nodes)
            .force("charge", d3.forceManyBody().strength(-400))
            .force("link", d3.forceLink(links).distance(200).strength(1).iterations(10).id(function(d) {return d.id; }))
            .force("x", d3.forceX())
            .force("y", d3.forceY())
            .stop();

        var loading = svg.append("text")
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .attr("font-family", "sans-serif")
            .attr("font-size", 10)
            .text("Simulating. One moment please…");

        // Use a timeout to allow the rest of the page to load first.
        d3.timeout(function() {
            loading.remove();

            // See https://github.com/d3/d3-force/blob/master/README.md#simulation_tick
            for (var i = 0, n = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())); i < n; ++i) {
                simulation.tick();
            }

            g.append("g")
                .attr("stroke", "#000")
                .attr("stroke-width", 1.5)
                .selectAll("line")
                .data(Array.from(links))
                .enter().append("line")
                .attr("x1", function(d) { return d.source.x; })
                .attr("y1", function(d) { return d.source.y; })
                .attr("x2", function(d) { return d.target.x; })
                .attr("y2", function(d) { return d.target.y; });

            console.log(nodes);
            var node = g
                .selectAll(null)
                .data(nodes)
                .enter()
                .append("g")
                .each(d => console.log(d))
                .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

            var circle = node
                .append('circle')
                .attr('stroke', 'black')
                .attr('fill', 'white')
                .attr("r", 10);

            node
                .append('text')
                .text(
                    function(d) {
                        console.log(d);
                        return d.id;
                    }
                );
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
layout.registerComponent('cfgViewer', function(container, componentState) {
    container.getElement().html('<div id="' + cfgViewer.id + '"></div>');
});
layout.registerComponent('testComponent', function(container, componentState) {
    container.getElement().html('<h2>' + componentState.label + '</h2>');
});

layout.init();

