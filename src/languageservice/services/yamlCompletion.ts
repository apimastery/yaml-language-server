/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as Json from 'jsonc-parser';
import * as SchemaService from './jsonSchemaService';
import { PromiseConstructor, ASTNode, PropertyASTNode, ArrayASTNode, JSONDocument, JSONWorkerContribution, CompletionsCollector, ObjectASTNode, Diagnostic, ClientCapabilities, CompletionList } from 'vscode-json-languageservice';

import { CompletionItem, CompletionItemKind, TextDocument, Position, Range, TextEdit, InsertTextFormat, MarkupContent, MarkupKind } from 'vscode-languageserver-types';

import * as nls from 'vscode-nls';
import { LanguageSettings } from '../yamlLanguageService';
import { JSONSchemaRef, JSONSchema } from 'vscode-json-languageservice/lib/umd/jsonSchema';
import { isDefined } from '../utils/objects';
import { stringifyObject, contains } from '../utils/json';
import { endsWith } from '../utils/strings';
import { matchOffsetToDocument } from '../utils/arrUtils';
import { ObjectASTNodeImpl, StringASTNodeImpl, PropertyASTNodeImpl, NullASTNodeImpl } from '../parser/jsonParser2';
const localize = nls.loadMessageBundle();

export interface IApplicableSchema {
	node: ASTNode;
	inverted?: boolean;
	schema: JSONSchema;
}

export interface JSONDoc extends JSONDocument {
	getNodeFromOffset(offset: number, includeRightBound?): ASTNode | undefined;
	visit(visitor: (node: ASTNode) => boolean): void;
	validate(textDocument: TextDocument, schema: JSONSchema): Diagnostic[];
	getMatchingSchemas(schema: JSONSchema, focusOffset?: number, exclude?: ASTNode): IApplicableSchema[];
}


export class YAMLCompletion {

	private schemaService: SchemaService.IJSONSchemaService;
	private contributions: JSONWorkerContribution[];
	private promiseConstructor: PromiseConstructor = Promise;
	private supportsMarkdown: boolean | undefined;
	private clientCapabilities: ClientCapabilities = {}
	private customTags: Array<String>;
	private completion: boolean;

	constructor(schemaService: SchemaService.IJSONSchemaService, contributions: JSONWorkerContribution[] = [], promiseConstructor?: PromiseConstructor) {
		this.schemaService = schemaService;
		this.contributions = contributions;
		this.customTags = [];
		this.completion = true;
	}

	public configure(languageSettings: LanguageSettings, customTags: Array<String>){
		if (languageSettings) {
			this.completion = languageSettings.completion;
		}
		this.customTags = customTags;
	}

	public doResolve(item: CompletionItem): Thenable<CompletionItem> {
		for (let i = this.contributions.length - 1; i >= 0; i--) {
			if (this.contributions[i].resolveCompletion) {
				let resolver = this.contributions[i].resolveCompletion(item);
				if (resolver) {
					return resolver;
				}
			}
		}
		return this.promiseConstructor.resolve(item);
	}

	public doComplete(document: TextDocument, position: Position, doc: JSONDoc): Thenable<CompletionList> {

		let result: CompletionList = {
			items: [],
			isIncomplete: false
		};

		if (!this.completion) {
			return Promise.resolve(result);
		}

		let offset = document.offsetAt(position);
		if(document.getText()[offset] === ":"){
			return Promise.resolve(result);
		}
		
		let currentDoc = matchOffsetToDocument(offset, doc);
		if(currentDoc === null){
			return Promise.resolve(result);
		}

		currentDoc.getNodeFromOffset = function(offset: number) {
			let collector = [];
			let findNode = (node: ASTNode): ASTNode => {
				if (offset >= node.offset && offset <= (node.offset + node.length)) {
					let children = node.children;
					for (let i = 0; i < children.length && children[i].offset <= offset; i++) {
						let item = findNode(children[i]);
						if (item) {
							collector.push(item);
						}
					}
					return node;
				}
				return null;
			};
			let foundNode = findNode(currentDoc.root);
			let currMinDist = Number.MAX_VALUE;
			let currMinNode = null;
			for(let possibleNode in collector){
				let currNode = collector[possibleNode];
				let minDist = (currNode.offset - offset) + (offset - (currNode.offset + currNode.length));
				if(Math.abs(minDist) < currMinDist) {
					currMinNode = currNode;
					currMinDist = minDist;
				}
			}
			return currMinNode || foundNode;
		}

		let node = currentDoc.getNodeFromOffset(offset) as ASTNode;
		// if (this.isInComment(document, node ? node.offset : 0, offset)) {
		// 	return Promise.resolve(result);
		// }

		let currentWord = this.getCurrentWord(document, offset);
		let overwriteRange = null;

		// TODO
		if (node && (node.type === 'string' || node.type === 'number' || node.type === 'boolean' || node.type === 'null')) {
			overwriteRange = Range.create(document.positionAt(node.offset), document.positionAt(node.offset + node.length));
		} else {
			let overwriteStart = offset - currentWord.length;
			if (overwriteStart > 0 && document.getText()[overwriteStart - 1] === '"') {
				overwriteStart--;
			}
			overwriteRange = Range.create(document.positionAt(overwriteStart), position);
		}

		let proposed: { [key: string]: CompletionItem } = {};
		let collector: CompletionsCollector = {
			add: (suggestion: CompletionItem) => {
				let existing = proposed[suggestion.label];
				if (!existing) {
					proposed[suggestion.label] = suggestion;
					if (overwriteRange) {
						suggestion.textEdit = TextEdit.replace(overwriteRange, suggestion.insertText);
					}

					result.items.push(suggestion);
				} else if (!existing.documentation) {
					existing.documentation = suggestion.documentation;
				}
			},
			setAsIncomplete: () => {
				result.isIncomplete = true;
			},
			error: (message: string) => {
				console.error(message);
			},
			log: (message: string) => {
				console.log(message);
			},
			getNumberOfProposals: () => {
				return result.items.length;
			}
		};

		return this.schemaService.getSchemaForResource(document.uri, doc).then((schema) => {
			let collectionPromises: Thenable<any>[] = [];

			let addValue = true;
			let currentKey = '';

			let currentProperty: PropertyASTNode = null;
			if (node) {

				if (node.type === 'string') {
					let parent = node.parent;
					if (parent && parent.type === 'property' && parent.keyNode === node) {
						addValue = !parent.valueNode;
						currentProperty = parent;
						currentKey = document.getText().substr(node.offset, node.length);
						if (parent) {
							node = parent.parent;
						}
					}
				}
			}

			// proposals for properties
			if (node && node.type === 'object') {
				// don't suggest keys when the cursor is just before the opening curly brace
				// TODO is this needed?
				// if (node.offset === offset) {
				// 	return result;
				// }
				// don't suggest properties that are already present
				let properties = node.properties;
				properties.forEach(p => {
					if (!currentProperty || currentProperty !== p) {
						proposed[p.keyNode.value] = CompletionItem.create('__');
					}
				});
				let separatorAfter = '';
				if (addValue) {
					separatorAfter = this.evaluateSeparatorAfter(document, document.offsetAt(overwriteRange.end));
				}

				if (schema) {
					
						// property proposals with schema
						this.getPropertyCompletions(schema, currentDoc.jsonDoc, node, addValue, separatorAfter, collector);
					
					
				}

				// let location = Parser.getNodePath(node);
				// this.contributions.forEach((contribution) => {
				// 	let collectPromise = contribution.collectPropertyCompletions(document.uri, location, currentWord, addValue, separatorAfter === '', collector);
				// 	if (collectPromise) {
				// 		collectionPromises.push(collectPromise);
				// 	}
				// });
				if ((!schema && currentWord.length > 0 && document.getText().charAt(offset - currentWord.length - 1) !== '"')) {
					collector.add({
						kind: CompletionItemKind.Property,
						label: this.getLabelForValue(currentWord),
						insertText: this.getInsertTextForProperty(currentWord, null, false, separatorAfter),
						insertTextFormat: InsertTextFormat.Snippet, documentation: '',
					});
					collector.setAsIncomplete();
				}
			} else if(node && node.type === 'array') {
				let separatorAfter = '';
				if (addValue) {
					separatorAfter = this.evaluateSeparatorAfter(document, document.offsetAt(overwriteRange.end));
				}

				if (schema) {
					// property proposals with schema
					this.getArrayPropertyCompletions(schema, currentDoc.jsonDoc, node, addValue, separatorAfter, collector);
				}
			}

			// proposals for values
			let types: { [type: string]: boolean } = {};
			if (schema) {
				// value proposals with schema
				this.getValueCompletions(schema, currentDoc.jsonDoc, node, offset, document, collector, types);
			}
			// if (this.contributions.length > 0) {
			// 	this.getContributedValueCompletions(doc, node, offset, document, collector, collectionPromises);
			// }

			return result;
			// return this.promiseConstructor.all(collectionPromises).then(() => {
			// 	if (collector.getNumberOfProposals() === 0) {
			// 		let offsetForSeparator = offset;
			// 		if (node && (node.type === 'string' || node.type === 'number' || node.type === 'boolean' || node.type === 'null')) {
			// 			offsetForSeparator = node.offset + node.length;
			// 		}
			// 		let separatorAfter = this.evaluateSeparatorAfter(document, offsetForSeparator);
			// 		this.addFillerValueCompletions(types, separatorAfter, collector);
			// 	}
			// 	return result;
			// });
		});
	}

	private getArrayPropertyCompletions(schema: SchemaService.ResolvedSchema, doc: JSONDoc, node: ASTNode, addValue: boolean, separatorAfter: string, collector: CompletionsCollector): void {
		// let matchingSchemas = doc.getMatchingSchemas(schema.schema, node.offset);
		// matchingSchemas.forEach((s) => {
		// 	if (s.node === node && !s.inverted) {
		// 		let schemaProperties = s.schema.items;
		// 		if (schemaProperties) {
		// 			Object.keys(schemaProperties["properties"]).forEach((key: string) => {
		// 				let propertySchema = schemaProperties[key];
						
		// 				let proposal: CompletionItem = {
		// 					kind: CompletionItemKind.Property,
		// 					label: this.sanitizeLabel(key),
		// 					insertText: this.getInsertTextForProperty(key, propertySchema, addValue, separatorAfter),
		// 					insertTextFormat: InsertTextFormat.Snippet,
		// 					filterText: this.getFilterTextForValue(key),
		// 					documentation: '',
		// 				};
		// 				collector.add(proposal);
						
		// 			});
		// 		}
		// 	}
		// });
	}

	private getPropertyCompletions(schema: SchemaService.ResolvedSchema, doc: JSONDoc, node: ASTNode, addValue: boolean, separatorAfter: string, collector: CompletionsCollector): void {
		let matchingSchemas = doc.getMatchingSchemas(schema.schema, node.offset);
		matchingSchemas.forEach((s) => {
			if (s.node === node && !s.inverted) {
				let schemaProperties = s.schema.properties;
				if (schemaProperties) {
					Object.keys(schemaProperties).forEach((key: string) => {
						let propertySchema = schemaProperties[key];
						if (typeof propertySchema === 'object' && !propertySchema.deprecationMessage && !propertySchema.doNotSuggest) {
							let proposal: CompletionItem = {
								kind: CompletionItemKind.Property,
								label: this.sanitizeLabel(key),
								insertText: this.getInsertTextForProperty(key, propertySchema, addValue, separatorAfter),
								insertTextFormat: InsertTextFormat.Snippet,
								filterText: this.getFilterTextForValue(key),
								documentation: this.fromMarkup(propertySchema.markdownDescription) || propertySchema.description || '',
							};
							if (endsWith(proposal.insertText, `$1${separatorAfter}`)) {
								proposal.command = {
									title: 'Suggest',
									command: 'editor.action.triggerSuggest'
								};
							}
							collector.add(proposal);
						}
						// Error fix
						// If this is a array of string/boolean/number
						//  test:
						//    - item1
						// it will treated as a property key since `:` has been appended
						if (node.type === 'object' && node.parent && node.parent.type === 'array' && s.schema.type !== 'object') {
							this.addSchemaValueCompletions(s.schema, separatorAfter, collector, {});
						}
					});
				}
			}
		});
	}

	private getValueCompletions(schema: SchemaService.ResolvedSchema, doc: JSONDoc, node: ASTNode, offset: number, document: TextDocument, collector: CompletionsCollector, types: { [type: string]: boolean }): void {
		let offsetForSeparator = offset;
		let parentKey: string = null;
		let valueNode: ASTNode = null;

		if (node && (node.type === 'string' || node.type === 'number' || node.type === 'boolean')) {
			offsetForSeparator = node.offset + node.length;
			valueNode = node;
			node = node.parent;
		}

		if(node && node.type === 'null'){
			let nodeParent = node.parent;
			valueNode = node;

			/*
			 * This is going to be an object for some reason and we need to find the property
			 * Its an issue with the null node
			 */
			if(nodeParent && nodeParent.type === "object"){
				for(let prop in nodeParent["properties"]){
					let currNode = nodeParent["properties"][prop];
					if(currNode.valueNode && currNode.valueNode.offset === node.offset){
						node = currNode;
					}
				}
			}
		}

		if (!node) {
			this.addSchemaValueCompletions(schema.schema, '', collector, types);
			return;
		}

		if ((node.type === 'property') && offset > node.colonOffset) {
			let valueNode = node.valueNode;
			if (valueNode && offset > (valueNode.offset + valueNode.length)) {
				return; // we are past the value node
			}
			parentKey = node.keyNode.value;
			node = node.parent;
		}

		if (node && (parentKey !== null || node.type === 'array')) {
			let separatorAfter = this.evaluateSeparatorAfter(document, offsetForSeparator);

			let matchingSchemas = doc.getMatchingSchemas(schema.schema, node.offset, valueNode);
			matchingSchemas.forEach(s => {
				if (s.node === node && !s.inverted && s.schema) {
					if (node.type === 'array' && s.schema.items) {
						if (Array.isArray(s.schema.items)) {
							let index = this.findItemAtOffset(node, document, offset);
							if (index < s.schema.items.length) {
								this.addSchemaValueCompletions(s.schema.items[index], separatorAfter, collector, types);
							}
						} else {
							this.addSchemaValueCompletions(s.schema.items, separatorAfter, collector, types);
						}
					}
					if (s.schema.properties) {
						let propertySchema = s.schema.properties[parentKey];
						if (propertySchema) {
							this.addSchemaValueCompletions(propertySchema, separatorAfter, collector, types);
						}
					}
				}
			});
			if (parentKey === '$schema' && !node.parent) {
				this.addDollarSchemaCompletions(separatorAfter, collector);
			}
			if (types['boolean']) {
				this.addBooleanValueCompletion(true, separatorAfter, collector);
				this.addBooleanValueCompletion(false, separatorAfter, collector);
			}
			if (types['null']) {
				this.addNullValueCompletion(separatorAfter, collector);
			}
		}

	}

	// private getContributedValueCompletions(doc: JSONDoc, node: ASTNode, offset: number, document: TextDocument, collector: CompletionsCollector, collectionPromises: Thenable<any>[]) {
	// 	if (!node) {
	// 		this.contributions.forEach((contribution) => {
	// 			let collectPromise = contribution.collectDefaultCompletions(document.uri, collector);
	// 			if (collectPromise) {
	// 				collectionPromises.push(collectPromise);
	// 			}
	// 		});
	// 	} else {
	// 		if (node.type === 'string' || node.type === 'number' || node.type === 'boolean' || node.type === 'null') {
	// 			node = node.parent;
	// 		}
	// 		if ((node.type === 'property') && offset > node.colonOffset) {
	// 			let parentKey = node.keyNode.value;

	// 			let valueNode = node.valueNode;
	// 			if (!valueNode || offset <= (valueNode.offset + valueNode.length)) {
	// 				let location = Parser.getNodePath(node.parent);
	// 				this.contributions.forEach((contribution) => {
	// 					let collectPromise = contribution.collectValueCompletions(document.uri, location, parentKey, collector);
	// 					if (collectPromise) {
	// 						collectionPromises.push(collectPromise);
	// 					}
	// 				});
	// 			}
	// 		}
	// 	}
	// }

	private addSchemaValueCompletions(schema: JSONSchemaRef, separatorAfter: string, collector: CompletionsCollector, types: { [type: string]: boolean }): void {
		if (typeof schema === 'object') {
			this.addEnumValueCompletions(schema, separatorAfter, collector);
			this.addDefaultValueCompletions(schema, separatorAfter, collector);
			this.collectTypes(schema, types);
			if (Array.isArray(schema.allOf)) {
				schema.allOf.forEach(s => this.addSchemaValueCompletions(s, separatorAfter, collector, types));
			}
			if (Array.isArray(schema.anyOf)) {
				schema.anyOf.forEach(s => this.addSchemaValueCompletions(s, separatorAfter, collector, types));
			}
			if (Array.isArray(schema.oneOf)) {
				schema.oneOf.forEach(s => this.addSchemaValueCompletions(s, separatorAfter, collector, types));
			}
		}
	}

	private addDefaultValueCompletions(schema: JSONSchema, separatorAfter: string, collector: CompletionsCollector, arrayDepth = 0): void {
		let hasProposals = false;
		if (isDefined(schema.default)) {
			let type = schema.type;
			let value = schema.default;
			for (let i = arrayDepth; i > 0; i--) {
				value = [value];
				type = 'array';
			}
			collector.add({
				kind: this.getSuggestionKind(type),
				label: this.getLabelForValue(value),
				insertText: this.getInsertTextForValue(value, separatorAfter),
				insertTextFormat: InsertTextFormat.Snippet,
				detail: localize('json.suggest.default', 'Default value')
			});
			hasProposals = true;
		}
		if (Array.isArray(schema.examples)) {
			schema.examples.forEach(example => {
				let type = schema.type;
				let value = example;
				for (let i = arrayDepth; i > 0; i--) {
					value = [value];
					type = 'array';
				}
				collector.add({
					kind: this.getSuggestionKind(type),
					label: this.getLabelForValue(value),
					insertText: this.getInsertTextForValue(value, separatorAfter),
					insertTextFormat: InsertTextFormat.Snippet
				});
				hasProposals = true;
			});
		}
		// if (Array.isArray(schema.defaultSnippets)) {
		// 	schema.defaultSnippets.forEach(s => {
		// 		let type = schema.type;
		// 		let value = s.body;
		// 		let label = s.label;
		// 		let insertText: string;
		// 		let filterText: string;
		// 		if (isDefined(value)) {
		// 			let type = schema.type;
		// 			for (let i = arrayDepth; i > 0; i--) {
		// 				value = [value];
		// 				type = 'array';
		// 			}
		// 			insertText = this.getInsertTextForSnippetValue(value, separatorAfter);
		// 			filterText = this.getFilterTextForSnippetValue(value);
		// 			label = label || this.getLabelForSnippetValue(value);
		// 		} else if (typeof s.bodyText === 'string') {
		// 			let prefix = '', suffix = '', indent = '';
		// 			for (let i = arrayDepth; i > 0; i--) {
		// 				prefix = prefix + indent + '[\n';
		// 				suffix = suffix + '\n' + indent + ']';
		// 				indent += '\t';
		// 				type = 'array';
		// 			}
		// 			insertText = prefix + indent + s.bodyText.split('\n').join('\n' + indent) + suffix + separatorAfter;
		// 			label = label || this.sanitizeLabel(insertText),
		// 			filterText = insertText.replace(/[\n]/g, '');   // remove new lines
		// 		}
		// 		collector.add({
		// 			kind: this.getSuggestionKind(type),
		// 			label,
		// 			documentation: this.fromMarkup(s.markdownDescription) || s.description,
		// 			insertText,
		// 			insertTextFormat: InsertTextFormat.Snippet,
		// 			filterText
		// 		});
		// 		hasProposals = true;
		// 	});
		// }
		if (!hasProposals && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
			this.addDefaultValueCompletions(schema.items, separatorAfter, collector, arrayDepth + 1);
		}
	}


	private addEnumValueCompletions(schema: JSONSchema, separatorAfter: string, collector: CompletionsCollector): void {
		if (isDefined(schema.const)) {
			collector.add({
				kind: this.getSuggestionKind(schema.type),
				label: this.getLabelForValue(schema.const),
				insertText: this.getInsertTextForValue(schema.const, separatorAfter),
				insertTextFormat: InsertTextFormat.Snippet,
				documentation: this.fromMarkup(schema.markdownDescription) || schema.description
			});
		}

		if (Array.isArray(schema.enum)) {
			for (let i = 0, length = schema.enum.length; i < length; i++) {
				let enm = schema.enum[i];
				let documentation: string | MarkupContent = this.fromMarkup(schema.markdownDescription) || schema.description;
				if (schema.markdownEnumDescriptions && i < schema.markdownEnumDescriptions.length && this.doesSupportMarkdown()) {
					documentation = this.fromMarkup(schema.markdownEnumDescriptions[i]);
				} else if (schema.enumDescriptions && i < schema.enumDescriptions.length) {
					documentation = schema.enumDescriptions[i];
				}
				collector.add({
					kind: this.getSuggestionKind(schema.type),
					label: this.getLabelForValue(enm),
					insertText: this.getInsertTextForValue(enm, separatorAfter),
					insertTextFormat: InsertTextFormat.Snippet,
					documentation
				});
			}
		}
	}

	private collectTypes(schema: JSONSchema, types: { [type: string]: boolean }) {
		if (Array.isArray(schema.enum) || isDefined(schema.const)) {
			return;
		}
		let type = schema.type;
		if (Array.isArray(type)) {
			type.forEach(t => types[t] = true);
		} else {
			types[type] = true;
		}
	}

	private addBooleanValueCompletion(value: boolean, separatorAfter: string, collector: CompletionsCollector): void {
		collector.add({
			kind: this.getSuggestionKind('boolean'),
			label: value ? 'true' : 'false',
			insertText: this.getInsertTextForValue(value, separatorAfter),
			insertTextFormat: InsertTextFormat.Snippet,
			documentation: ''
		});
	}

	private addNullValueCompletion(separatorAfter: string, collector: CompletionsCollector): void {
		collector.add({
			kind: this.getSuggestionKind('null'),
			label: 'null',
			insertText: 'null' + separatorAfter,
			insertTextFormat: InsertTextFormat.Snippet,
			documentation: ''
		});
	}

	private addDollarSchemaCompletions(separatorAfter: string, collector: CompletionsCollector): void {
		let schemaIds = this.schemaService.getRegisteredSchemaIds(schema => schema === 'http' || schema === 'https');
		schemaIds.forEach(schemaId => collector.add({
			kind: CompletionItemKind.Module,
			label: this.getLabelForValue(schemaId),
			filterText: this.getFilterTextForValue(schemaId),
			insertText: this.getInsertTextForValue(schemaId, separatorAfter),
			insertTextFormat: InsertTextFormat.Snippet, documentation: ''
		}));
	}

	private sanitizeLabel(label: string): string {
		label = label.replace(/[\n]/g, '↵');
		if (label.length > 57) {
			label = label.substr(0, 57).trim() + '...';
		}
		return label;
	}

	private getLabelForValue(value: any): string {
		return this.sanitizeLabel(JSON.stringify(value));
	}

	private getFilterTextForValue(value): string {
		return JSON.stringify(value);
	}

	private getFilterTextForSnippetValue(value): string {
		return JSON.stringify(value).replace(/\$\{\d+:([^}]+)\}|\$\d+/g, '$1');
	}

	private getLabelForSnippetValue(value: any): string {
		let label = JSON.stringify(value);
		label = label.replace(/\$\{\d+:([^}]+)\}|\$\d+/g, '$1');
		return this.sanitizeLabel(label);
	}

	private getInsertTextForPlainText(text: string): string {
		return text.replace(/[\\\$\}]/g, '\\$&');   // escape $, \ and } 
	}

	private getInsertTextForValue(value: any, separatorAfter: string): string {
		var text = JSON.stringify(value, null, '\t');
		if (text === '{}') {
			return '{$1}' + separatorAfter;
		} else if (text === '[]') {
			return '[$1]' + separatorAfter;
		}
		return this.getInsertTextForPlainText(text + separatorAfter);
	}

	private getInsertTextForSnippetValue(value: any, separatorAfter: string): string {
		let replacer = (value) => {
			if (typeof value === 'string') {
				if (value[0] === '^') {
					return value.substr(1);
				}
			}
			return JSON.stringify(value);
		};
		return stringifyObject(value, '', replacer) + separatorAfter;
	}

	private templateVarIdCounter = 0;

	private getInsertTextForGuessedValue(value: any, separatorAfter: string): string {
		switch (typeof value) {
			case 'object':
				if (value === null) {
					return '${1:null}' + separatorAfter;
				}
				return this.getInsertTextForValue(value, separatorAfter);
			case 'string':
				let snippetValue = JSON.stringify(value);
				snippetValue = snippetValue.substr(1, snippetValue.length - 2); // remove quotes
				snippetValue = this.getInsertTextForPlainText(snippetValue); // escape \ and }
				return '"${1:' + snippetValue + '}"' + separatorAfter;
			case 'number':
			case 'boolean':
				return '${1:' + JSON.stringify(value) + '}' + separatorAfter;
		}
		return this.getInsertTextForValue(value, separatorAfter);
	}

	private getSuggestionKind(type: any): CompletionItemKind {
		if (Array.isArray(type)) {
			let array = <any[]>type;
			type = array.length > 0 ? array[0] : null;
		}
		if (!type) {
			return CompletionItemKind.Value;
		}
		switch (type) {
			case 'string': return CompletionItemKind.Value;
			case 'object': return CompletionItemKind.Module;
			case 'property': return CompletionItemKind.Property;
			default: return CompletionItemKind.Value;
		}
	}

	private getLabelTextForMatchingNode(node: ASTNode, document: TextDocument): string {
		switch (node.type) {
			case 'array':
				return '[]';
			case 'object':
				return '{}';
			default:
				let content = document.getText().substr(node.offset, node.length);
				return content;
		}
	}

	private getInsertTextForMatchingNode(node: ASTNode, document: TextDocument, separatorAfter: string): string {
		switch (node.type) {
			case 'array':
				return this.getInsertTextForValue([], separatorAfter);
			case 'object':
				return this.getInsertTextForValue({}, separatorAfter);
			default:
				let content = document.getText().substr(node.offset, node.length) + separatorAfter;
				return this.getInsertTextForPlainText(content);
		}
	}

	private getInsertTextForProperty(key: string, propertySchema: JSONSchema, addValue: boolean, separatorAfter: string): string {

		let propertyText = this.getInsertTextForValue(key, '');
		if (!addValue) {
			return propertyText;
		}
		let resultText = propertyText + ': ';

		let value;
		let nValueProposals = 0;
		if (propertySchema) {
			if (Array.isArray(propertySchema.defaultSnippets)) {
				if (propertySchema.defaultSnippets.length === 1) {
					let body = propertySchema.defaultSnippets[0].body;
					if (isDefined(body)) {
						value = this.getInsertTextForSnippetValue(body, '');
					}
				}
				nValueProposals += propertySchema.defaultSnippets.length;
			}
			if (propertySchema.enum) {
				if (!value && propertySchema.enum.length === 1) {
					value = this.getInsertTextForGuessedValue(propertySchema.enum[0], '');
				}
				nValueProposals += propertySchema.enum.length;
			}
			if (isDefined(propertySchema.default)) {
				if (!value) {
					value = this.getInsertTextForGuessedValue(propertySchema.default, '');
				}
				nValueProposals++;
			}
			if (nValueProposals === 0) {
				var type = Array.isArray(propertySchema.type) ? propertySchema.type[0] : propertySchema.type;
				if (!type) {
					if (propertySchema.properties) {
						type = 'object';
					} else if (propertySchema.items) {
						type = 'array';
					}
				}
				switch (type) {
					case 'boolean':
						value = ' $1';
						break;
					case 'string':
						value = ' $1';
						break;
					case 'object':
						value = '\n\t';
						break;
					case 'array':
						value = '\n\t- ';
						break;
					case 'number':
					case 'integer':
						value = ' ${1:0}';
						break;
					case 'null':
						value = ' ${1:null}';
						break;
					default:
						return propertyText;
				}
			}
		}
		if (!value || nValueProposals > 1) {
			value = '$1';
		}
		return resultText + value + separatorAfter;
	}

	private getCurrentWord(document: TextDocument, offset: number) {
		var i = offset - 1;
		var text = document.getText();
		while (i >= 0 && ' \t\n\r\v":{[,]}'.indexOf(text.charAt(i)) === -1) {
			i--;
		}
		return text.substring(i + 1, offset);
	}

	private evaluateSeparatorAfter(document: TextDocument, offset: number) {
		return '';
		// let scanner = Json.createScanner(document.getText(), true);
		// scanner.setPosition(offset);
		// let token = scanner.scan();
		// switch (token) {
		// 	case Json.SyntaxKind.CommaToken:
		// 	case Json.SyntaxKind.CloseBraceToken:
		// 	case Json.SyntaxKind.CloseBracketToken:
		// 	case Json.SyntaxKind.EOF:
		// 		return '';
		// 	default:
		// 		return ',';
		// }
	}

	private findItemAtOffset(node: ArrayASTNode, document: TextDocument, offset: number) {
		let scanner = Json.createScanner(document.getText(), true);
		let children = node.items;
		for (let i = children.length - 1; i >= 0; i--) {
			let child = children[i];
			if (offset > child.offset + child.length) {
				scanner.setPosition(child.offset + child.length);
				let token = scanner.scan();
				if (token === Json.SyntaxKind.CommaToken && offset >= scanner.getTokenOffset() + scanner.getTokenLength()) {
					return i + 1;
				}
				return i;
			} else if (offset >= child.offset) {
				return i;
			}
		}
		return 0;
	}

	private isInComment(document: TextDocument, start: number, offset: number) {
		let scanner = Json.createScanner(document.getText(), false);
		scanner.setPosition(start);
		let token = scanner.scan();
		while (token !== Json.SyntaxKind.EOF && (scanner.getTokenOffset() + scanner.getTokenLength() < offset)) {
			token = scanner.scan();
		}
		return (token === Json.SyntaxKind.LineCommentTrivia || token === Json.SyntaxKind.BlockCommentTrivia) && scanner.getTokenOffset() <= offset;
	}

	private fromMarkup(markupString: string | undefined): MarkupContent | string | undefined {
		if (markupString && this.doesSupportMarkdown()) {
			return {
				kind: MarkupKind.Markdown,
				value: markupString
			};
		}
		return undefined;
	}

	private doesSupportMarkdown() {
		if (!isDefined(this.supportsMarkdown)) {
			const completion = this.clientCapabilities.textDocument && this.clientCapabilities.textDocument.completion;
			this.supportsMarkdown = completion && completion.completionItem && Array.isArray(completion.completionItem.documentationFormat) && completion.completionItem.documentationFormat.indexOf(MarkupKind.Markdown) !== -1;
		}
		return this.supportsMarkdown;
	}
}
