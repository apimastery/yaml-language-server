"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const assert = require("assert");
const yamlParser07_1 = require("./../src/languageservice/parser/yamlParser07");
suite('YAML parser', () => {
    describe('YAML parser', function () {
        it('parse emtpy text', () => {
            const parsedDocument = yamlParser07_1.parse('');
            assert(parsedDocument.documents.length === 0, 'A document has been created for an empty text');
        });
        it('parse only comment', () => {
            const parsedDocument = yamlParser07_1.parse('# a comment');
            assert(parsedDocument.documents.length === 1, 'No document has been created when there is a comment');
        });
        it('parse single document with --- at the start of the file', () => {
            const parsedDocument = yamlParser07_1.parse('---\n# a comment\ntest: test');
            assert(parsedDocument.documents.length === 1, `A single document should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
        });
        it('parse multi document with --- at the start of the file', () => {
            const parsedDocument = yamlParser07_1.parse('---\n# a comment\ntest: test\n...\n---\n# second document\ntest2: test2');
            assert(parsedDocument.documents.length === 2, `two documents should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
            assert(parsedDocument.documents[1].lineComments.length === 1);
            assert(parsedDocument.documents[1].lineComments[0] === '# second document');
        });
        it('parse single document with directives and line comments', () => {
            const parsedDocument = yamlParser07_1.parse('%TAG !yaml! tag:yaml.org,2002:\n---\n# a comment\ntest');
            assert(parsedDocument.documents.length === 1, `A single document should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
        });
        it('parse 2 documents with directives and line comments', () => {
            const parsedDocument = yamlParser07_1.parse('%TAG !yaml! tag:yaml.org,2002:\n# a comment\ntest\n...\n---\ntest2');
            assert(parsedDocument.documents.length === 2, `2 documents should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
            assert(parsedDocument.documents[1].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[1].root.children.length}`);
            assert(parsedDocument.documents[1].root.value === 'test2');
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
        });
        it('parse single document', () => {
            const parsedDocument = yamlParser07_1.parse('test');
            assert(parsedDocument.documents.length === 1, `A single document should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
        });
        it('parse single document with directives', () => {
            const parsedDocument = yamlParser07_1.parse('%TAG !yaml! tag:yaml.org,2002:\n---\ntest');
            assert(parsedDocument.documents.length === 1, `A single document should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
        });
        it('parse 2 documents', () => {
            const parsedDocument = yamlParser07_1.parse('test\n---\ntest2');
            assert(parsedDocument.documents.length === 2, `2 documents should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
            assert(parsedDocument.documents[0].root.value === 'test');
            assert(parsedDocument.documents[1].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[1].root.children.length}`);
            assert(parsedDocument.documents[1].root.value === 'test2');
        });
        it('parse 3 documents', () => {
            const parsedDocument = yamlParser07_1.parse('test\n---\ntest2\n---\ntest3');
            assert(parsedDocument.documents.length === 3, `3 documents should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
            assert(parsedDocument.documents[0].root.value === 'test');
            assert(parsedDocument.documents[1].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[1].root.children.length}`);
            assert(parsedDocument.documents[1].root.value === 'test2');
            assert(parsedDocument.documents[2].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[2].root.children.length}`);
            assert(parsedDocument.documents[2].root.value === 'test3');
        });
        it('parse single document with comment', () => {
            const parsedDocument = yamlParser07_1.parse('# a comment\ntest');
            assert(parsedDocument.documents.length === 1, `A single document should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
        });
        it('parse 2 documents with comment', () => {
            const parsedDocument = yamlParser07_1.parse('---\n# a comment\ntest: test\n---\n# a second comment\ntest2');
            assert(parsedDocument.documents.length === 2, `2 documents should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].root.children.length === 1, `There should one children available but there are ${parsedDocument.documents[0].root.children.length}`);
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
            assert(parsedDocument.documents[1].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
            assert(parsedDocument.documents[1].lineComments.length === 1);
            assert(parsedDocument.documents[1].lineComments[0] === '# a second comment');
        });
        it('parse 2 documents with comment and a directive', () => {
            const parsedDocument = yamlParser07_1.parse('%TAG !yaml! tag:yaml.org,2002:\n---\n# a comment\ntest\n---\n# a second comment\ntest2');
            assert(parsedDocument.documents.length === 2, `2 documents should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
            assert(parsedDocument.documents[1].root.children.length === 0, `There should no children available but there are ${parsedDocument.documents[0].root.children.length}`);
            assert(parsedDocument.documents[1].lineComments.length === 1);
            assert(parsedDocument.documents[1].lineComments[0] === '# a second comment');
        });
        it('parse document with comment first', () => {
            const parsedDocument = yamlParser07_1.parse('# a comment\n---\ntest:test');
            assert(parsedDocument.documents.length === 1, `1 document should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
        });
        it('parse document with comment first and directive', () => {
            const parsedDocument = yamlParser07_1.parse('# a comment\n%TAG !yaml! tag:yaml.org,2002:\ntest: test');
            assert(parsedDocument.documents.length === 1, `1 document should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
        });
        it('parse document with comment first, directive, and seperator', () => {
            const parsedDocument = yamlParser07_1.parse('# a comment\n%TAG !yaml! tag:yaml.org,2002:\n---test: test');
            assert(parsedDocument.documents.length === 1, `1 document should be available but there are ${parsedDocument.documents.length}`);
            assert(parsedDocument.documents[0].lineComments.length === 1);
            assert(parsedDocument.documents[0].lineComments[0] === '# a comment');
        });
    });
});
//# sourceMappingURL=yamlParser.test.js.map