"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ServiceSetup {
    constructor() {
        /*
         * By default the service setup is going to have everything disabled
         * and each test is going to enable a feature with a with function call
         */
        this.languageSettings = {
            validate: false,
            hover: false,
            completion: false,
            format: false,
            isKubernetes: false,
            schemas: [],
            customTags: [],
            indentation: undefined,
        };
    }
    withValidate() {
        this.languageSettings.validate = true;
        return this;
    }
    withHover() {
        this.languageSettings.hover = true;
        return this;
    }
    withCompletion() {
        this.languageSettings.completion = true;
        return this;
    }
    withFormat() {
        this.languageSettings.format = true;
        return this;
    }
    withKubernetes() {
        this.languageSettings.isKubernetes = true;
        return this;
    }
    withSchemaFileMatch(schemaFileMatch) {
        this.languageSettings.schemas.push(schemaFileMatch);
        return this;
    }
    withCustomTags(customTags) {
        this.languageSettings.customTags = customTags;
        return this;
    }
    withIndentation(indentation) {
        this.languageSettings.indentation = indentation;
        return this;
    }
}
exports.ServiceSetup = ServiceSetup;
//# sourceMappingURL=serviceSetup.js.map