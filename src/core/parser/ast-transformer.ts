/**
 * AST Transformer
 *
 * Transforms Tree-sitter Concrete Syntax Tree (CST) into
 * Universal Code Entity (UCE) format.
 *
 * @module
 */

import type { Tree, Node } from "web-tree-sitter";
import type {
  UCEFile,
  UCEFunction,
  UCEClass,
  UCEInterface,
  UCETypeAlias,
  UCEVariable,
  UCEImport,
  UCEExport,
  UCELocation,
  UCEParameter,
  UCETypeParameter,
  UCEModifier,
  UCEMethod,
  UCEProperty,
  UCEInterfaceProperty,
  UCEInterfaceMethod,
  UCEImportSpecifier,
  UCEParseError,
  UCEVisibility,
} from "../../types/uce.js";

// =============================================================================
// Types
// =============================================================================

type SyntaxNode = Node;

/**
 * Transformation options
 */
export interface TransformOptions {
  /** Whether to include function bodies (can be large) */
  includeBodies?: boolean;
  /** Maximum body length to include (truncate if longer) */
  maxBodyLength?: number;
  /** Whether to calculate cyclomatic complexity */
  calculateComplexity?: boolean;
}

const DEFAULT_OPTIONS: Required<TransformOptions> = {
  includeBodies: true,
  maxBodyLength: 5000,
  calculateComplexity: true,
};

// =============================================================================
// AST Transformer Class
// =============================================================================

/**
 * Transforms Tree-sitter parse trees into UCE format.
 *
 * @example
 * ```typescript
 * const transformer = new ASTTransformer();
 * const uceFile = transformer.transform(tree, sourceCode, '/path/to/file.ts', 'typescript');
 * console.log(uceFile.functions);
 * console.log(uceFile.classes);
 * ```
 */
export class ASTTransformer {
  private options: Required<TransformOptions>;
  private sourceCode: string = "";
  private filePath: string = "";

  constructor(options: TransformOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Transforms a Tree-sitter tree into UCE format.
   */
  transform(
    tree: Tree,
    sourceCode: string,
    filePath: string,
    language: string
  ): UCEFile {
    this.sourceCode = sourceCode;
    this.filePath = filePath;

    const rootNode = tree.rootNode;
    const errors: UCEParseError[] = this.collectErrors(rootNode);

    return {
      filePath,
      language,
      functions: this.extractFunctions(rootNode),
      classes: this.extractClasses(rootNode),
      interfaces: this.extractInterfaces(rootNode),
      typeAliases: this.extractTypeAliases(rootNode),
      variables: this.extractVariables(rootNode),
      imports: this.extractImports(rootNode),
      exports: this.extractExports(rootNode),
      errors,
    };
  }

  // ===========================================================================
  // Function Extraction
  // ===========================================================================

  /**
   * Extracts all top-level functions from the AST.
   */
  private extractFunctions(rootNode: SyntaxNode): UCEFunction[] {
    const functions: UCEFunction[] = [];

    // Find function declarations
    this.findNodes(rootNode, [
      "function_declaration",
      "generator_function_declaration",
      "arrow_function",
      "function_expression",
    ]).forEach((node) => {
      // Skip if inside a class
      if (this.isInsideClass(node)) return;

      const fn = this.parseFunctionNode(node);
      if (fn) {
        functions.push(fn);
      }
    });

    // Find exported arrow functions assigned to variables
    this.findNodes(rootNode, ["lexical_declaration", "variable_declaration"]).forEach(
      (node) => {
        if (this.isInsideClass(node)) return;

        const declarator = node.childForFieldName("declarator") ||
          node.children.find((c: SyntaxNode) => c.type === "variable_declarator");

        if (declarator) {
          const value = declarator.childForFieldName("value");
          if (value?.type === "arrow_function" || value?.type === "function_expression") {
            const fn = this.parseArrowFunctionVariable(node, declarator, value);
            if (fn) {
              functions.push(fn);
            }
          }
        }
      }
    );

    return functions;
  }

  /**
   * Parses a function declaration node.
   */
  private parseFunctionNode(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    // Skip anonymous functions at file level
    if (!name && node.type !== "arrow_function") {
      return null;
    }

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("return_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode).replace(/^:\s*/, "") : null;

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    const modifiers = this.extractFunctionModifiers(node);
    const docComment = this.extractDocComment(node);
    const signature = this.buildFunctionSignature(name, params, returnType, typeParams, modifiers);

    return {
      kind: "function",
      name,
      params,
      returnType,
      typeParams,
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature,
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses an arrow function assigned to a variable.
   */
  private parseArrowFunctionVariable(
    declNode: SyntaxNode,
    declarator: SyntaxNode,
    arrowFn: SyntaxNode
  ): UCEFunction | null {
    const nameNode = declarator.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = arrowFn.childForFieldName("parameters");
    const params = paramsNode ? this.parseParameters(paramsNode) : [];

    const returnTypeNode = arrowFn.childForFieldName("return_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode).replace(/^:\s*/, "") : null;

    const typeParamsNode = arrowFn.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = arrowFn.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    const modifiers = this.extractVariableModifiers(declNode);
    if (arrowFn.children.some((c: SyntaxNode) => c.type === "async")) {
      modifiers.push("async");
    }

    const docComment = this.extractDocComment(declNode);
    const signature = this.buildFunctionSignature(name, params, returnType, typeParams, modifiers);

    return {
      kind: "function",
      name,
      params,
      returnType,
      typeParams,
      body,
      location: this.getLocation(declNode),
      modifiers,
      docComment,
      signature,
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  // ===========================================================================
  // Class Extraction
  // ===========================================================================

  /**
   * Extracts all class declarations.
   */
  private extractClasses(rootNode: SyntaxNode): UCEClass[] {
    const classes: UCEClass[] = [];

    this.findNodes(rootNode, ["class_declaration"]).forEach((node) => {
      const cls = this.parseClassNode(node);
      if (cls) {
        classes.push(cls);
      }
    });

    return classes;
  }

  /**
   * Parses a class declaration node.
   */
  private parseClassNode(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Extract heritage clause
    const heritageNode = node.children.find((c: SyntaxNode) => c.type === "class_heritage");
    let extendsClass: string | null = null;
    const implementsList: string[] = [];

    if (heritageNode) {
      const extendsClause = heritageNode.children.find((c: SyntaxNode) => c.type === "extends_clause");
      if (extendsClause) {
        const typeNode = extendsClause.children.find(
          (c: SyntaxNode) => c.type === "type_identifier" || c.type === "identifier"
        );
        extendsClass = typeNode?.text ?? null;
      }

      const implementsClause = heritageNode.children.find((c: SyntaxNode) => c.type === "implements_clause");
      if (implementsClause) {
        implementsClause.children.forEach((child: SyntaxNode) => {
          if (child.type === "type_identifier" || child.type === "identifier") {
            implementsList.push(child.text);
          }
        });
      }
    }

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const { methods, properties, constructorMethod } = bodyNode
      ? this.parseClassBody(bodyNode)
      : { methods: [], properties: [], constructorMethod: null };

    const modifiers = this.extractClassModifiers(node);
    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams,
      extends: extendsClass,
      implements: implementsList,
      methods,
      properties,
      constructor: constructorMethod,
      location: this.getLocation(node),
      modifiers,
      docComment,
      isAbstract: modifiers.includes("abstract"),
    };
  }

  /**
   * Parses a class body to extract methods and properties.
   */
  private parseClassBody(bodyNode: SyntaxNode): {
    methods: UCEMethod[];
    properties: UCEProperty[];
    constructorMethod: UCEMethod | null;
  } {
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    for (const child of bodyNode.children) {
      if (child.type === "method_definition") {
        const method = this.parseMethodNode(child);
        if (method) {
          if (method.name === "constructor") {
            constructorMethod = method;
          } else {
            methods.push(method);
          }
        }
      } else if (
        child.type === "public_field_definition" ||
        child.type === "field_definition"
      ) {
        const prop = this.parsePropertyNode(child);
        if (prop) {
          properties.push(prop);
        }
      }
    }

    return { methods, properties, constructorMethod };
  }

  /**
   * Parses a method definition node.
   */
  private parseMethodNode(node: SyntaxNode): UCEMethod | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("return_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode).replace(/^:\s*/, "") : null;

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    const modifiers = this.extractMethodModifiers(node);
    const visibility = this.extractVisibility(modifiers);
    const docComment = this.extractDocComment(node);
    const signature = this.buildFunctionSignature(name, params, returnType, typeParams, modifiers);

    const isGetter = node.children.some((c: SyntaxNode) => c.type === "get");
    const isSetter = node.children.some((c: SyntaxNode) => c.type === "set");

    return {
      kind: "method",
      name,
      params,
      returnType,
      typeParams,
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature,
      visibility,
      isStatic: modifiers.includes("static"),
      isAbstract: modifiers.includes("abstract"),
      isGetter,
      isSetter,
    };
  }

  /**
   * Parses a property/field definition node.
   */
  private parsePropertyNode(node: SyntaxNode): UCEProperty | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const typeNode = node.childForFieldName("type");
    const type = typeNode ? this.getNodeText(typeNode).replace(/^:\s*/, "") : null;

    const valueNode = node.childForFieldName("value");
    const defaultValue = valueNode ? this.getNodeText(valueNode) : null;

    const modifiers = this.extractPropertyModifiers(node);
    const visibility = this.extractVisibility(modifiers);
    const docComment = this.extractDocComment(node);

    return {
      kind: "property",
      name,
      type,
      visibility,
      isStatic: modifiers.includes("static"),
      isReadonly: modifiers.includes("readonly"),
      isOptional: node.children.some((c: SyntaxNode) => c.type === "?"),
      defaultValue,
      location: this.getLocation(node),
      docComment,
    };
  }

  // ===========================================================================
  // Interface Extraction
  // ===========================================================================

  /**
   * Extracts all interface declarations.
   */
  private extractInterfaces(rootNode: SyntaxNode): UCEInterface[] {
    const interfaces: UCEInterface[] = [];

    this.findNodes(rootNode, ["interface_declaration"]).forEach((node) => {
      const iface = this.parseInterfaceNode(node);
      if (iface) {
        interfaces.push(iface);
      }
    });

    return interfaces;
  }

  /**
   * Parses an interface declaration node.
   */
  private parseInterfaceNode(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Extract extends
    const extendsList: string[] = [];
    const extendsClause = node.children.find((c: SyntaxNode) => c.type === "extends_type_clause");
    if (extendsClause) {
      extendsClause.children.forEach((child: SyntaxNode) => {
        if (child.type === "type_identifier" || child.type === "identifier") {
          extendsList.push(child.text);
        }
      });
    }

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const { properties, methods } = bodyNode
      ? this.parseInterfaceBody(bodyNode)
      : { properties: [], methods: [] };

    const modifiers = this.extractInterfaceModifiers(node);
    const docComment = this.extractDocComment(node);

    return {
      kind: "interface",
      name,
      typeParams,
      extends: extendsList,
      properties,
      methods,
      location: this.getLocation(node),
      modifiers,
      docComment,
    };
  }

  /**
   * Parses an interface body.
   */
  private parseInterfaceBody(bodyNode: SyntaxNode): {
    properties: UCEInterfaceProperty[];
    methods: UCEInterfaceMethod[];
  } {
    const properties: UCEInterfaceProperty[] = [];
    const methods: UCEInterfaceMethod[] = [];

    for (const child of bodyNode.children) {
      if (child.type === "property_signature") {
        const prop = this.parseInterfaceProperty(child);
        if (prop) {
          properties.push(prop);
        }
      } else if (
        child.type === "method_signature" ||
        child.type === "call_signature"
      ) {
        const method = this.parseInterfaceMethod(child);
        if (method) {
          methods.push(method);
        }
      }
    }

    return { properties, methods };
  }

  /**
   * Parses an interface property signature.
   */
  private parseInterfaceProperty(node: SyntaxNode): UCEInterfaceProperty | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const typeNode = node.childForFieldName("type");
    const type = typeNode ? this.getNodeText(typeNode).replace(/^:\s*/, "") : null;

    const isOptional = node.children.some((c: SyntaxNode) => c.type === "?");
    const isReadonly = node.children.some((c: SyntaxNode) => c.text === "readonly");
    const docComment = this.extractDocComment(node);

    return {
      kind: "property",
      name,
      type,
      isReadonly,
      isOptional,
      location: this.getLocation(node),
      docComment,
    };
  }

  /**
   * Parses an interface method signature.
   */
  private parseInterfaceMethod(node: SyntaxNode): UCEInterfaceMethod | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("return_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode).replace(/^:\s*/, "") : null;

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const isOptional = node.children.some((c: SyntaxNode) => c.type === "?");
    const docComment = this.extractDocComment(node);
    const signature = this.buildFunctionSignature(name, params, returnType, typeParams, []);

    return {
      kind: "method",
      name,
      params,
      returnType,
      typeParams,
      signature,
      isOptional,
      location: this.getLocation(node),
      docComment,
    };
  }

  // ===========================================================================
  // Type Alias Extraction
  // ===========================================================================

  /**
   * Extracts all type alias declarations.
   */
  private extractTypeAliases(rootNode: SyntaxNode): UCETypeAlias[] {
    const aliases: UCETypeAlias[] = [];

    this.findNodes(rootNode, ["type_alias_declaration"]).forEach((node) => {
      const alias = this.parseTypeAliasNode(node);
      if (alias) {
        aliases.push(alias);
      }
    });

    return aliases;
  }

  /**
   * Parses a type alias declaration.
   */
  private parseTypeAliasNode(node: SyntaxNode): UCETypeAlias | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const valueNode = node.childForFieldName("value");
    const typeDefinition = valueNode ? this.getNodeText(valueNode) : "";

    const modifiers = this.extractTypeAliasModifiers(node);
    const docComment = this.extractDocComment(node);

    return {
      kind: "typeAlias",
      name,
      typeParams,
      typeDefinition,
      location: this.getLocation(node),
      modifiers,
      docComment,
    };
  }

  // ===========================================================================
  // Variable Extraction
  // ===========================================================================

  /**
   * Extracts module-level variable declarations.
   */
  private extractVariables(rootNode: SyntaxNode): UCEVariable[] {
    const variables: UCEVariable[] = [];

    this.findNodes(rootNode, ["lexical_declaration", "variable_declaration"]).forEach(
      (node) => {
        // Skip if inside a function or class
        if (this.isInsideFunction(node) || this.isInsideClass(node)) return;

        const declarations = node.children.filter(
          (c: SyntaxNode) => c.type === "variable_declarator"
        );

        for (const decl of declarations) {
          // Skip arrow functions (already handled as functions)
          const value = decl.childForFieldName("value");
          if (value?.type === "arrow_function" || value?.type === "function_expression") {
            continue;
          }

          const variable = this.parseVariableDeclarator(node, decl);
          if (variable) {
            variables.push(variable);
          }
        }
      }
    );

    return variables;
  }

  /**
   * Parses a variable declarator.
   */
  private parseVariableDeclarator(
    declNode: SyntaxNode,
    declarator: SyntaxNode
  ): UCEVariable | null {
    const nameNode = declarator.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const typeNode = declarator.childForFieldName("type");
    const type = typeNode ? this.getNodeText(typeNode).replace(/^:\s*/, "") : null;

    const valueNode = declarator.childForFieldName("value");
    const initialValue = valueNode ? this.truncateBody(this.getNodeText(valueNode)) : null;

    const isConst = declNode.children.some((c: SyntaxNode) => c.text === "const");
    const isExported = this.hasExportModifier(declNode);
    const docComment = this.extractDocComment(declNode);

    return {
      kind: "variable",
      name,
      type,
      isConst,
      isExported,
      initialValue,
      location: this.getLocation(declarator),
      docComment,
    };
  }

  // ===========================================================================
  // Import Extraction
  // ===========================================================================

  /**
   * Extracts all import statements.
   */
  private extractImports(rootNode: SyntaxNode): UCEImport[] {
    const imports: UCEImport[] = [];

    this.findNodes(rootNode, ["import_statement"]).forEach((node) => {
      const imp = this.parseImportNode(node);
      if (imp) {
        imports.push(imp);
      }
    });

    return imports;
  }

  /**
   * Parses an import statement.
   */
  private parseImportNode(node: SyntaxNode): UCEImport | null {
    const sourceNode = node.childForFieldName("source");
    const source = sourceNode ? this.stripQuotes(sourceNode.text) : "";

    if (!source) return null;

    const specifiers: UCEImportSpecifier[] = [];
    const importClause = node.children.find((c: SyntaxNode) => c.type === "import_clause");

    if (importClause) {
      // Default import
      const defaultImport = importClause.children.find(
        (c: SyntaxNode) => c.type === "identifier"
      );
      if (defaultImport) {
        specifiers.push({
          local: defaultImport.text,
          imported: "default",
          type: "default",
        });
      }

      // Namespace import (import * as name)
      const namespaceImport = importClause.children.find(
        (c: SyntaxNode) => c.type === "namespace_import"
      );
      if (namespaceImport) {
        const nameNode = namespaceImport.children.find(
          (c: SyntaxNode) => c.type === "identifier"
        );
        if (nameNode) {
          specifiers.push({
            local: nameNode.text,
            imported: "*",
            type: "namespace",
          });
        }
      }

      // Named imports
      const namedImports = importClause.children.find(
        (c: SyntaxNode) => c.type === "named_imports"
      );
      if (namedImports) {
        namedImports.children.forEach((child: SyntaxNode) => {
          if (child.type === "import_specifier") {
            const importedNode = child.childForFieldName("name");
            const aliasNode = child.childForFieldName("alias");
            const imported = importedNode?.text ?? "";
            const local = aliasNode?.text ?? imported;

            if (imported) {
              specifiers.push({
                local,
                imported,
                type: "named",
              });
            }
          }
        });
      }
    }

    const isTypeOnly = node.children.some((c: SyntaxNode) => c.text === "type");
    const isSideEffect = specifiers.length === 0;

    return {
      kind: "import",
      source,
      specifiers,
      isTypeOnly,
      isSideEffect,
      location: this.getLocation(node),
    };
  }

  // ===========================================================================
  // Export Extraction
  // ===========================================================================

  /**
   * Extracts all export statements.
   */
  private extractExports(rootNode: SyntaxNode): UCEExport[] {
    const exports: UCEExport[] = [];

    // Export statements
    this.findNodes(rootNode, ["export_statement"]).forEach((node) => {
      const exp = this.parseExportNode(node);
      if (exp) {
        exports.push(...(Array.isArray(exp) ? exp : [exp]));
      }
    });

    return exports;
  }

  /**
   * Parses an export statement.
   */
  private parseExportNode(node: SyntaxNode): UCEExport | UCEExport[] | null {
    const isTypeOnly = node.children.some((c: SyntaxNode) => c.text === "type");

    // Check for default export
    const isDefault = node.children.some((c: SyntaxNode) => c.text === "default");
    if (isDefault) {
      const declaration = node.children.find(
        (c: SyntaxNode) =>
          c.type === "function_declaration" ||
          c.type === "class_declaration" ||
          c.type === "identifier" ||
          c.type === "expression"
      );
      const name = declaration?.childForFieldName?.("name")?.text ?? "default";

      return {
        kind: "export",
        name: "default",
        localName: name !== "default" ? name : null,
        type: "default",
        source: null,
        isTypeOnly,
        location: this.getLocation(node),
      };
    }

    // Check for re-exports
    const sourceNode = node.childForFieldName("source");
    if (sourceNode) {
      const source = this.stripQuotes(sourceNode.text);
      const exports: UCEExport[] = [];

      // Check for namespace re-export (export * from)
      if (node.children.some((c: SyntaxNode) => c.text === "*")) {
        const namespaceExport = node.children.find(
          (c: SyntaxNode) => c.type === "namespace_export"
        );
        const aliasNode = namespaceExport?.children.find(
          (c: SyntaxNode) => c.type === "identifier"
        );

        exports.push({
          kind: "export",
          name: aliasNode?.text ?? "*",
          localName: null,
          type: aliasNode ? "namespace" : "re-export",
          source,
          isTypeOnly,
          location: this.getLocation(node),
        });
      }

      // Named re-exports
      const exportClause = node.children.find(
        (c: SyntaxNode) => c.type === "export_clause"
      );
      if (exportClause) {
        exportClause.children.forEach((child: SyntaxNode) => {
          if (child.type === "export_specifier") {
            const nameNode = child.childForFieldName("name");
            const aliasNode = child.childForFieldName("alias");
            const name = aliasNode?.text ?? nameNode?.text ?? "";
            const localName = nameNode?.text ?? null;

            if (name) {
              exports.push({
                kind: "export",
                name,
                localName: localName !== name ? localName : null,
                type: "re-export",
                source,
                isTypeOnly,
                location: this.getLocation(child),
              });
            }
          }
        });
      }

      return exports.length > 0 ? exports : null;
    }

    // Named exports without source (export { ... })
    const exportClause = node.children.find((c: SyntaxNode) => c.type === "export_clause");
    if (exportClause) {
      const exports: UCEExport[] = [];

      exportClause.children.forEach((child: SyntaxNode) => {
        if (child.type === "export_specifier") {
          const nameNode = child.childForFieldName("name");
          const aliasNode = child.childForFieldName("alias");
          const name = aliasNode?.text ?? nameNode?.text ?? "";
          const localName = nameNode?.text ?? null;

          if (name) {
            exports.push({
              kind: "export",
              name,
              localName: localName !== name ? localName : null,
              type: "named",
              source: null,
              isTypeOnly,
              location: this.getLocation(child),
            });
          }
        }
      });

      return exports.length > 0 ? exports : null;
    }

    // Export with declaration (export const/function/class)
    const declaration = node.children.find(
      (c: SyntaxNode) =>
        c.type === "function_declaration" ||
        c.type === "class_declaration" ||
        c.type === "interface_declaration" ||
        c.type === "type_alias_declaration" ||
        c.type === "lexical_declaration" ||
        c.type === "variable_declaration"
    );

    if (declaration) {
      const nameNode = declaration.childForFieldName?.("name");
      if (nameNode) {
        return {
          kind: "export",
          name: nameNode.text,
          localName: null,
          type: "named",
          source: null,
          isTypeOnly,
          location: this.getLocation(node),
        };
      }

      // Handle variable declarations
      const declarators = declaration.children.filter(
        (c: SyntaxNode) => c.type === "variable_declarator"
      );
      if (declarators.length > 0) {
        return declarators.map((d: SyntaxNode) => ({
          kind: "export" as const,
          name: d.childForFieldName("name")?.text ?? "",
          localName: null,
          type: "named" as const,
          source: null,
          isTypeOnly,
          location: this.getLocation(d),
        }));
      }
    }

    return null;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Finds all nodes of specified types in the tree.
   */
  private findNodes(root: SyntaxNode, types: string[]): SyntaxNode[] {
    const nodes: SyntaxNode[] = [];
    const typeSet = new Set(types);

    const walk = (node: SyntaxNode) => {
      if (typeSet.has(node.type)) {
        nodes.push(node);
      }
      for (const child of node.children) {
        walk(child);
      }
    };

    walk(root);
    return nodes;
  }

  /**
   * Parses function parameters.
   */
  private parseParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (
        child.type === "required_parameter" ||
        child.type === "optional_parameter" ||
        child.type === "rest_parameter"
      ) {
        const pattern = child.childForFieldName("pattern");
        const nameNode = pattern ?? child.children.find((c) => c.type === "identifier");
        const name = nameNode?.text ?? "";

        if (!name) continue;

        const typeNode = child.childForFieldName("type");
        const type = typeNode ? this.getNodeText(typeNode).replace(/^:\s*/, "") : null;

        const valueNode = child.childForFieldName("value");
        const defaultValue = valueNode ? this.getNodeText(valueNode) : null;

        params.push({
          name,
          type,
          isOptional: child.type === "optional_parameter" || defaultValue !== null,
          isRest: child.type === "rest_parameter",
          defaultValue,
        });
      }
    }

    return params;
  }

  /**
   * Parses type parameters.
   */
  private parseTypeParameters(typeParamsNode: SyntaxNode): UCETypeParameter[] {
    const typeParams: UCETypeParameter[] = [];

    for (const child of typeParamsNode.children) {
      if (child.type === "type_parameter") {
        const nameNode = child.childForFieldName("name");
        const name = nameNode?.text ?? "";

        if (!name) continue;

        const constraintNode = child.childForFieldName("constraint");
        const constraint = constraintNode
          ? this.getNodeText(constraintNode).replace(/^\s*extends\s*/, "")
          : null;

        const defaultNode = child.childForFieldName("value");
        const defaultType = defaultNode ? this.getNodeText(defaultNode) : null;

        typeParams.push({
          name,
          constraint,
          default: defaultType,
        });
      }
    }

    return typeParams;
  }

  /**
   * Extracts modifiers from a function node.
   */
  private extractFunctionModifiers(node: SyntaxNode): UCEModifier[] {
    const modifiers: UCEModifier[] = [];

    if (this.hasExportModifier(node)) modifiers.push("export");
    if (node.children.some((c: SyntaxNode) => c.type === "async")) modifiers.push("async");
    if (node.type === "generator_function_declaration") modifiers.push("async"); // generators treated similar

    return modifiers;
  }

  /**
   * Extracts modifiers from a variable declaration.
   */
  private extractVariableModifiers(node: SyntaxNode): UCEModifier[] {
    const modifiers: UCEModifier[] = [];

    if (this.hasExportModifier(node)) modifiers.push("export");
    if (node.children.some((c: SyntaxNode) => c.text === "const")) modifiers.push("const");

    return modifiers;
  }

  /**
   * Extracts modifiers from a class node.
   */
  private extractClassModifiers(node: SyntaxNode): UCEModifier[] {
    const modifiers: UCEModifier[] = [];

    if (this.hasExportModifier(node)) modifiers.push("export");
    if (node.children.some((c: SyntaxNode) => c.text === "abstract")) modifiers.push("abstract");

    return modifiers;
  }

  /**
   * Extracts modifiers from a method node.
   */
  private extractMethodModifiers(node: SyntaxNode): UCEModifier[] {
    const modifiers: UCEModifier[] = [];

    if (node.children.some((c: SyntaxNode) => c.text === "public")) modifiers.push("public");
    if (node.children.some((c: SyntaxNode) => c.text === "private")) modifiers.push("private");
    if (node.children.some((c: SyntaxNode) => c.text === "protected")) modifiers.push("protected");
    if (node.children.some((c: SyntaxNode) => c.text === "static")) modifiers.push("static");
    if (node.children.some((c: SyntaxNode) => c.text === "abstract")) modifiers.push("abstract");
    if (node.children.some((c: SyntaxNode) => c.text === "readonly")) modifiers.push("readonly");
    if (node.children.some((c: SyntaxNode) => c.text === "async")) modifiers.push("async");
    if (node.children.some((c: SyntaxNode) => c.text === "override")) modifiers.push("override");

    return modifiers;
  }

  /**
   * Extracts modifiers from a property node.
   */
  private extractPropertyModifiers(node: SyntaxNode): UCEModifier[] {
    const modifiers: UCEModifier[] = [];

    if (node.children.some((c: SyntaxNode) => c.text === "public")) modifiers.push("public");
    if (node.children.some((c: SyntaxNode) => c.text === "private")) modifiers.push("private");
    if (node.children.some((c: SyntaxNode) => c.text === "protected")) modifiers.push("protected");
    if (node.children.some((c: SyntaxNode) => c.text === "static")) modifiers.push("static");
    if (node.children.some((c: SyntaxNode) => c.text === "readonly")) modifiers.push("readonly");

    return modifiers;
  }

  /**
   * Extracts modifiers from an interface node.
   */
  private extractInterfaceModifiers(node: SyntaxNode): UCEModifier[] {
    const modifiers: UCEModifier[] = [];

    if (this.hasExportModifier(node)) modifiers.push("export");

    return modifiers;
  }

  /**
   * Extracts modifiers from a type alias node.
   */
  private extractTypeAliasModifiers(node: SyntaxNode): UCEModifier[] {
    const modifiers: UCEModifier[] = [];

    if (this.hasExportModifier(node)) modifiers.push("export");

    return modifiers;
  }

  /**
   * Extracts visibility from modifiers.
   */
  private extractVisibility(modifiers: UCEModifier[]): UCEVisibility {
    if (modifiers.includes("private")) return "private";
    if (modifiers.includes("protected")) return "protected";
    return "public";
  }

  /**
   * Checks if a node has an export modifier.
   */
  private hasExportModifier(node: SyntaxNode): boolean {
    // Check if parent is export_statement
    const parent = node.parent;
    return parent?.type === "export_statement";
  }

  /**
   * Checks if a node is inside a class.
   */
  private isInsideClass(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node.parent;
    while (current) {
      if (current.type === "class_declaration" || current.type === "class_body") {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Checks if a node is inside a function.
   */
  private isInsideFunction(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node.parent;
    while (current) {
      if (
        current.type === "function_declaration" ||
        current.type === "arrow_function" ||
        current.type === "function_expression" ||
        current.type === "method_definition"
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Extracts doc comment preceding a node.
   */
  private extractDocComment(node: SyntaxNode): string | null {
    // Look for comment in previous siblings
    let sibling = node.previousNamedSibling;
    while (sibling) {
      if (sibling.type === "comment") {
        const text = sibling.text;
        if (text.startsWith("/**") || text.startsWith("///")) {
          return text;
        }
        // Regular comment right before
        if (sibling.endPosition.row === node.startPosition.row - 1) {
          return text;
        }
      }
      if (sibling.type !== "comment") break;
      sibling = sibling.previousNamedSibling;
    }
    return null;
  }

  /**
   * Builds a function signature string.
   */
  private buildFunctionSignature(
    name: string,
    params: UCEParameter[],
    returnType: string | null,
    typeParams: UCETypeParameter[],
    modifiers: UCEModifier[]
  ): string {
    const parts: string[] = [];

    if (modifiers.includes("async")) parts.push("async");
    parts.push("function");
    parts.push(name);

    if (typeParams.length > 0) {
      const tpStrs = typeParams.map((tp) => {
        let s = tp.name;
        if (tp.constraint) s += ` extends ${tp.constraint}`;
        if (tp.default) s += ` = ${tp.default}`;
        return s;
      });
      parts[parts.length - 1] += `<${tpStrs.join(", ")}>`;
    }

    const paramStrs = params.map((p) => {
      let s = p.isRest ? `...${p.name}` : p.name;
      if (p.isOptional && !p.defaultValue) s += "?";
      if (p.type) s += `: ${p.type}`;
      if (p.defaultValue) s += ` = ${p.defaultValue}`;
      return s;
    });

    parts[parts.length - 1] += `(${paramStrs.join(", ")})`;

    if (returnType) {
      parts[parts.length - 1] += `: ${returnType}`;
    }

    return parts.join(" ");
  }

  /**
   * Gets the location of a node.
   */
  private getLocation(node: SyntaxNode): UCELocation {
    return {
      filePath: this.filePath,
      startLine: node.startPosition.row + 1, // Convert to 1-indexed
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
    };
  }

  /**
   * Gets the text of a node.
   */
  private getNodeText(node: SyntaxNode): string {
    return node.text;
  }

  /**
   * Truncates body text to max length.
   */
  private truncateBody(body: string): string {
    if (body.length <= this.options.maxBodyLength) {
      return body;
    }
    return body.slice(0, this.options.maxBodyLength) + "...";
  }

  /**
   * Strips quotes from a string.
   */
  private stripQuotes(str: string): string {
    return str.replace(/^['"`]|['"`]$/g, "");
  }

  /**
   * Calculates cyclomatic complexity of a function body.
   */
  private calculateComplexity(bodyNode: SyntaxNode | null): number {
    if (!bodyNode) return 1;

    let complexity = 1;

    const walk = (node: SyntaxNode) => {
      switch (node.type) {
        case "if_statement":
        case "while_statement":
        case "for_statement":
        case "for_in_statement":
        case "do_statement":
        case "ternary_expression":
        case "case":
        case "catch_clause":
        case "binary_expression":
          if (node.type === "binary_expression") {
            const op = node.children.find((c: SyntaxNode) => c.type === "&&" || c.type === "||");
            if (op) complexity++;
          } else {
            complexity++;
          }
          break;
      }

      for (const child of node.children) {
        walk(child);
      }
    };

    walk(bodyNode);
    return complexity;
  }

  /**
   * Collects parse errors from the tree.
   */
  private collectErrors(rootNode: SyntaxNode): UCEParseError[] {
    const errors: UCEParseError[] = [];

    const walk = (node: SyntaxNode) => {
      if (node.hasError || node.type === "ERROR") {
        errors.push({
          message: `Parse error at ${node.type}`,
          location: this.getLocation(node),
          severity: "error",
        });
      }
      for (const child of node.children) {
        walk(child);
      }
    };

    walk(rootNode);
    return errors;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates an ASTTransformer instance.
 */
export function createASTTransformer(options?: TransformOptions): ASTTransformer {
  return new ASTTransformer(options);
}
