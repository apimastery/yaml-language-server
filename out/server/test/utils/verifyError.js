"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
function createExpectedError(message, startLine, startCharacter, endLine, endCharacter, severity = 2) {
    return {
        message,
        range: {
            start: {
                line: startLine,
                character: startCharacter,
            },
            end: {
                line: endLine,
                character: endCharacter,
            },
        },
        severity,
    };
}
exports.createExpectedError = createExpectedError;
function createExpectedSymbolInformation(name, kind, containerName, uri, startLine, startCharacter, endLine, endCharacter) {
    return {
        name,
        kind,
        containerName,
        location: {
            uri,
            range: {
                start: {
                    line: startLine,
                    character: startCharacter,
                },
                end: {
                    line: endLine,
                    character: endCharacter,
                },
            },
        },
    };
}
exports.createExpectedSymbolInformation = createExpectedSymbolInformation;
function createExpectedDocumentSymbol(name, kind, startLine, startCharacter, endLine, endCharacter, startLineSelection, startCharacterSelection, endLineSelection, endCharacterSelection, children = []) {
    return {
        name,
        kind,
        range: {
            start: {
                character: startCharacter,
                line: startLine,
            },
            end: {
                character: endCharacter,
                line: endLine,
            },
        },
        selectionRange: {
            start: {
                character: startCharacterSelection,
                line: startLineSelection,
            },
            end: {
                character: endCharacterSelection,
                line: endLineSelection,
            },
        },
        children,
    };
}
exports.createExpectedDocumentSymbol = createExpectedDocumentSymbol;
function createExpectedCompletion(label, insertText, startLine, startCharacter, endLine, endCharacter, kind, insertTextFormat = 2, extra = {}) {
    return Object.assign({
        insertText,
        label,
        insertTextFormat,
        kind,
        textEdit: {
            newText: insertText,
            range: {
                start: {
                    line: startLine,
                    character: startCharacter,
                },
                end: {
                    line: endLine,
                    character: endCharacter,
                },
            },
        },
    }, extra);
}
exports.createExpectedCompletion = createExpectedCompletion;
//# sourceMappingURL=verifyError.js.map