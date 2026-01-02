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

/**
 * Language-specific node type mappings for function extraction
 */
const FUNCTION_NODE_TYPES: Record<string, string[]> = {
  typescript: ["function_declaration", "generator_function_declaration", "arrow_function", "function_expression"],
  javascript: ["function_declaration", "generator_function_declaration", "arrow_function", "function_expression"],
  tsx: ["function_declaration", "generator_function_declaration", "arrow_function", "function_expression"],
  jsx: ["function_declaration", "generator_function_declaration", "arrow_function", "function_expression"],
  go: ["function_declaration", "method_declaration"],
  rust: ["function_item"],
  python: ["function_definition"],
  java: ["method_declaration", "constructor_declaration"],
  c: ["function_definition"],
  cpp: ["function_definition"],
  csharp: ["method_declaration", "constructor_declaration"],
  kotlin: ["function_declaration"],
  swift: ["function_declaration"],
  dart: ["function_signature", "method_signature"],
  ruby: ["method", "singleton_method"],
  php: ["function_definition", "method_declaration"],
  bash: ["function_definition"],
  scala: ["function_definition", "function_declaration"],
  haskell: ["function", "signature"],
  elixir: ["call"], // Elixir uses def/defp which are macro calls
  lua: ["function_declaration", "function_definition"],
  json: [], // JSON doesn't have functions
  yaml: [], // YAML doesn't have functions
  toml: [], // TOML doesn't have functions
};

/**
 * Language-specific node type mappings for class extraction
 */
const CLASS_NODE_TYPES: Record<string, string[]> = {
  typescript: ["class_declaration"],
  javascript: ["class_declaration"],
  tsx: ["class_declaration"],
  jsx: ["class_declaration"],
  go: ["type_spec"], // Go structs are defined via type_spec
  rust: ["struct_item", "impl_item"],
  python: ["class_definition"],
  java: ["class_declaration"],
  c: ["struct_specifier"], // C structs
  cpp: ["class_specifier", "struct_specifier"], // C++ classes and structs
  csharp: ["class_declaration", "struct_declaration"], // C# classes and structs
  kotlin: ["class_declaration", "object_declaration"], // Kotlin classes and objects
  swift: ["class_declaration", "struct_declaration"], // Swift classes and structs
  dart: ["class_definition"], // Dart classes
  ruby: ["class", "module"], // Ruby classes and modules
  php: ["class_declaration"], // PHP classes
  bash: [], // Bash doesn't have classes
  scala: ["class_definition", "object_definition", "trait_definition"], // Scala classes, objects, traits
  haskell: ["data_type", "newtype"], // Haskell algebraic data types
  elixir: ["call"], // Elixir modules are defmodule calls
  lua: [], // Lua doesn't have classes (uses tables/metatables)
  json: [], // JSON doesn't have classes
  yaml: [], // YAML doesn't have classes
  toml: [], // TOML doesn't have classes
};

/**
 * Language-specific node type mappings for interface extraction
 */
const INTERFACE_NODE_TYPES: Record<string, string[]> = {
  typescript: ["interface_declaration"],
  javascript: [],
  tsx: ["interface_declaration"],
  jsx: [],
  go: ["type_spec"], // Go interfaces are also type_spec
  rust: ["trait_item"],
  python: [], // Python doesn't have formal interfaces (ABCs are classes)
  java: ["interface_declaration"],
  c: [], // C doesn't have interfaces
  cpp: [], // C++ uses abstract classes, no dedicated interface type
  csharp: ["interface_declaration"], // C# interfaces
  kotlin: ["class_declaration"], // Kotlin interfaces (use class_declaration with interface keyword)
  swift: ["protocol_declaration"], // Swift protocols
  dart: [], // Dart uses abstract classes
  ruby: [], // Ruby doesn't have interfaces (uses duck typing/mixins)
  php: ["interface_declaration"], // PHP interfaces
  bash: [], // Bash doesn't have interfaces
  scala: ["trait_definition"], // Scala traits act as interfaces
  haskell: ["class"], // Haskell type classes
  elixir: ["call"], // Elixir behaviours are macro calls
  lua: [], // Lua doesn't have interfaces
  json: [], // JSON doesn't have interfaces
  yaml: [], // YAML doesn't have interfaces
  toml: [], // TOML doesn't have interfaces
};

/**
 * Language-specific node type mappings for import extraction
 */
const IMPORT_NODE_TYPES: Record<string, string[]> = {
  typescript: ["import_statement"],
  javascript: ["import_statement"],
  tsx: ["import_statement"],
  jsx: ["import_statement"],
  go: ["import_declaration"],
  rust: ["use_declaration"],
  python: ["import_statement", "import_from_statement"],
  java: ["import_declaration"],
  c: ["preproc_include"], // C uses #include
  cpp: ["preproc_include"], // C++ uses #include
  csharp: ["using_directive"], // C# uses using
  kotlin: ["import_header"], // Kotlin imports
  swift: ["import_declaration"], // Swift imports
  dart: ["import_or_export"], // Dart imports
  ruby: ["call"], // Ruby require/require_relative are method calls
  php: ["namespace_use_declaration"], // PHP use statements
  bash: ["command"], // Bash source/. commands
  scala: ["import_declaration"], // Scala imports
  haskell: ["import"], // Haskell imports
  elixir: ["call"], // Elixir import/require/use are macro calls
  lua: ["call"], // Lua require() calls
  json: [], // JSON doesn't have imports
  yaml: [], // YAML doesn't have imports
  toml: [], // TOML doesn't have imports
};

/**
 * Language-specific node type mappings for variable extraction
 */
const VARIABLE_NODE_TYPES: Record<string, string[]> = {
  typescript: ["lexical_declaration", "variable_declaration"],
  javascript: ["lexical_declaration", "variable_declaration"],
  tsx: ["lexical_declaration", "variable_declaration"],
  jsx: ["lexical_declaration", "variable_declaration"],
  go: ["var_declaration", "const_declaration", "short_var_declaration"],
  rust: ["let_declaration", "const_item", "static_item"],
  python: ["expression_statement"], // Python assignments are expression statements
  java: ["local_variable_declaration", "field_declaration"],
  c: ["declaration"], // C variable declarations
  cpp: ["declaration"], // C++ variable declarations
  csharp: ["field_declaration", "local_declaration_statement"], // C# variable declarations
  kotlin: ["property_declaration"], // Kotlin val/var
  swift: ["property_declaration", "variable_declaration"], // Swift let/var
  dart: ["initialized_variable_definition"], // Dart variables
  ruby: ["assignment"], // Ruby variable assignments
  php: ["property_declaration"], // PHP class properties
  bash: ["variable_assignment"], // Bash variable assignments
  scala: ["val_definition", "var_definition"], // Scala val/var
  haskell: ["function"], // Haskell bindings
  elixir: ["call"], // Elixir module attributes are @ calls
  lua: ["assignment_statement", "local_variable_declaration"], // Lua local/assignment
  json: [], // JSON doesn't have variables (keys are extracted differently)
  yaml: [], // YAML doesn't have variables (keys are extracted differently)
  toml: [], // TOML doesn't have variables (keys are extracted differently)
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
  private language: string = "";

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
    this.language = language;

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
    const nodeTypes = FUNCTION_NODE_TYPES[this.language] ?? FUNCTION_NODE_TYPES["typescript"] ?? [];

    // Find function declarations based on language
    this.findNodes(rootNode, nodeTypes).forEach((node) => {
      // Skip if inside a class (for TypeScript/JavaScript/Java)
      if (this.isInsideClass(node) && !["go", "rust"].includes(this.language)) return;

      const fn = this.parseFunctionNode(node);
      if (fn) {
        functions.push(fn);
      }
    });

    // For TypeScript/JavaScript, also find exported arrow functions assigned to variables
    if (["typescript", "javascript", "tsx", "jsx"].includes(this.language)) {
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
    }

    return functions;
  }

  /**
   * Parses a function declaration node.
   */
  private parseFunctionNode(node: SyntaxNode): UCEFunction | null {
    // Handle language-specific function parsing
    switch (this.language) {
      case "go":
        return this.parseGoFunction(node);
      case "rust":
        return this.parseRustFunction(node);
      case "python":
        return this.parsePythonFunction(node);
      case "java":
        return this.parseJavaFunction(node);
      case "c":
        return this.parseCFunction(node);
      case "cpp":
        return this.parseCppFunction(node);
      case "csharp":
        return this.parseCSharpFunction(node);
      case "kotlin":
        return this.parseKotlinFunction(node);
      case "swift":
        return this.parseSwiftFunction(node);
      case "dart":
        return this.parseDartFunction(node);
      case "ruby":
        return this.parseRubyFunction(node);
      case "php":
        return this.parsePhpFunction(node);
      case "bash":
        return this.parseBashFunction(node);
      case "scala":
        return this.parseScalaFunction(node);
      case "haskell":
        return this.parseHaskellFunction(node);
      case "elixir":
        return this.parseElixirFunction(node);
      case "lua":
        return this.parseLuaFunction(node);
      default:
        return this.parseTypeScriptFunction(node);
    }
  }

  /**
   * Parses a TypeScript/JavaScript function node.
   */
  private parseTypeScriptFunction(node: SyntaxNode): UCEFunction | null {
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
   * Parses a Go function node.
   */
  private parseGoFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Go uses "parameters" field for function params
    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseGoParameters(paramsNode) : [];

    // Go return type is in "result" field
    const resultNode = node.childForFieldName("result");
    const returnType = resultNode ? this.getNodeText(resultNode) : null;

    // Go doesn't have type parameters in the same way (generics added in 1.18)
    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Check if this is a method (has receiver)
    const receiverNode = node.childForFieldName("receiver");
    const modifiers: UCEModifier[] = [];
    if (receiverNode) {
      modifiers.push("public"); // Go methods on exported types
    }

    const docComment = this.extractDocComment(node);
    const signature = `func ${name}(${params.map(p => `${p.name} ${p.type || ""}`).join(", ")})${returnType ? " " + returnType : ""}`;

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
   * Parses Go function parameters.
   */
  private parseGoParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "parameter_declaration") {
        // Go parameter_declaration can have multiple names with one type
        const nameNodes = child.children.filter((c) => c.type === "identifier");
        const typeNode = child.children.find((c) =>
          c.type === "type_identifier" ||
          c.type === "pointer_type" ||
          c.type === "slice_type" ||
          c.type === "array_type" ||
          c.type === "map_type" ||
          c.type === "channel_type" ||
          c.type === "qualified_type"
        );
        const type = typeNode ? this.getNodeText(typeNode) : null;

        for (const nameNode of nameNodes) {
          params.push({
            name: nameNode.text,
            type,
            isOptional: false,
            isRest: false,
            defaultValue: null,
          });
        }
      } else if (child.type === "variadic_parameter_declaration") {
        const nameNode = child.children.find((c) => c.type === "identifier");
        const typeNode = child.children.find((c) => c.type !== "identifier" && c.type !== "...");
        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: false,
          isRest: true,
          defaultValue: null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a Rust function node.
   */
  private parseRustFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseRustParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("return_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode).replace(/^->\s*/, "") : null;

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Check visibility modifiers
    const modifiers: UCEModifier[] = [];
    if (node.children.some((c: SyntaxNode) => c.type === "visibility_modifier")) {
      modifiers.push("public");
    }
    if (node.children.some((c: SyntaxNode) => c.text === "async")) {
      modifiers.push("async");
    }

    const docComment = this.extractDocComment(node);
    const signature = `fn ${name}(${params.map(p => `${p.name}: ${p.type || "_"}`).join(", ")})${returnType ? " -> " + returnType : ""}`;

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
   * Parses Rust function parameters.
   */
  private parseRustParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "parameter") {
        const patternNode = child.childForFieldName("pattern");
        const typeNode = child.childForFieldName("type");

        params.push({
          name: patternNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: false,
          isRest: false,
          defaultValue: null,
        });
      } else if (child.type === "self_parameter") {
        params.push({
          name: "self",
          type: child.text.includes("&mut") ? "&mut Self" : child.text.includes("&") ? "&Self" : "Self",
          isOptional: false,
          isRest: false,
          defaultValue: null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a Python function node.
   */
  private parsePythonFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parsePythonParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("return_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode).replace(/^->\s*/, "") : null;

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Check for decorators
    const modifiers: UCEModifier[] = [];
    const decorators = node.children.filter((c: SyntaxNode) => c.type === "decorator");
    for (const dec of decorators) {
      const decName = dec.text;
      if (decName.includes("@staticmethod")) modifiers.push("static");
      if (decName.includes("@classmethod")) modifiers.push("static");
      if (decName.includes("@property")) modifiers.push("readonly");
      if (decName.includes("@abstractmethod")) modifiers.push("abstract");
    }

    // Check for async
    if (node.children.some((c: SyntaxNode) => c.text === "async")) {
      modifiers.push("async");
    }

    const docComment = this.extractPythonDocstring(bodyNode);
    const signature = `def ${name}(${params.map(p => `${p.name}${p.type ? ": " + p.type : ""}${p.defaultValue ? " = " + p.defaultValue : ""}`).join(", ")})${returnType ? " -> " + returnType : ""}`;

    return {
      kind: "function",
      name,
      params,
      returnType,
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature,
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses Python function parameters.
   */
  private parsePythonParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "identifier") {
        params.push({
          name: child.text,
          type: null,
          isOptional: false,
          isRest: false,
          defaultValue: null,
        });
      } else if (child.type === "typed_parameter") {
        const nameNode = child.children.find((c) => c.type === "identifier");
        const typeNode = child.childForFieldName("type");
        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: false,
          isRest: false,
          defaultValue: null,
        });
      } else if (child.type === "default_parameter") {
        const nameNode = child.childForFieldName("name");
        const valueNode = child.childForFieldName("value");
        params.push({
          name: nameNode?.text ?? "",
          type: null,
          isOptional: true,
          isRest: false,
          defaultValue: valueNode ? this.getNodeText(valueNode) : null,
        });
      } else if (child.type === "typed_default_parameter") {
        const nameNode = child.childForFieldName("name");
        const typeNode = child.childForFieldName("type");
        const valueNode = child.childForFieldName("value");
        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: true,
          isRest: false,
          defaultValue: valueNode ? this.getNodeText(valueNode) : null,
        });
      } else if (child.type === "list_splat_pattern" || child.text.startsWith("*")) {
        const nameNode = child.children.find((c) => c.type === "identifier");
        params.push({
          name: nameNode?.text ?? child.text.replace("*", ""),
          type: null,
          isOptional: false,
          isRest: true,
          defaultValue: null,
        });
      } else if (child.type === "dictionary_splat_pattern" || child.text.startsWith("**")) {
        const nameNode = child.children.find((c) => c.type === "identifier");
        params.push({
          name: nameNode?.text ?? child.text.replace("**", ""),
          type: null,
          isOptional: false,
          isRest: true,
          defaultValue: null,
        });
      }
    }

    return params;
  }

  /**
   * Extracts Python docstring from function body.
   */
  private extractPythonDocstring(bodyNode: SyntaxNode | null): string | null {
    if (!bodyNode) return null;

    // Look for the first expression_statement containing a string
    for (const child of bodyNode.children) {
      if (child.type === "expression_statement") {
        const stringNode = child.children.find((c) => c.type === "string");
        if (stringNode) {
          return stringNode.text;
        }
      }
      // Stop looking after non-docstring statements
      if (child.type !== "expression_statement" && child.type !== "comment") {
        break;
      }
    }
    return null;
  }

  /**
   * Parses a Java function (method) node.
   */
  private parseJavaFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseJavaParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode) : null;

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Extract modifiers
    const modifiers: UCEModifier[] = [];
    const modifierNode = node.children.find((c: SyntaxNode) => c.type === "modifiers");
    if (modifierNode) {
      for (const mod of modifierNode.children) {
        if (mod.text === "public") modifiers.push("public");
        if (mod.text === "private") modifiers.push("private");
        if (mod.text === "protected") modifiers.push("protected");
        if (mod.text === "static") modifiers.push("static");
        if (mod.text === "final") modifiers.push("readonly");
        if (mod.text === "abstract") modifiers.push("abstract");
        if (mod.text === "synchronized") modifiers.push("async"); // approximation
      }
    }

    const docComment = this.extractDocComment(node);
    const signature = `${modifiers.filter(m => ["public", "private", "protected", "static"].includes(m)).join(" ")} ${returnType || "void"} ${name}(${params.map(p => `${p.type || "Object"} ${p.name}`).join(", ")})`;

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
      signature: signature.trim(),
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses Java method parameters.
   */
  private parseJavaParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "formal_parameter") {
        const typeNode = child.childForFieldName("type");
        const nameNode = child.childForFieldName("name");
        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: false,
          isRest: false,
          defaultValue: null,
        });
      } else if (child.type === "spread_parameter") {
        const typeNode = child.childForFieldName("type");
        const nameNode = child.childForFieldName("name");
        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) + "..." : null,
          isOptional: false,
          isRest: true,
          defaultValue: null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a C function definition.
   */
  private parseCFunction(node: SyntaxNode): UCEFunction | null {
    const declaratorNode = node.childForFieldName("declarator");
    if (!declaratorNode) return null;

    // The function name is inside the declarator
    const nameNode = this.findFunctionDeclaratorName(declaratorNode);
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Get parameters from the declarator
    const paramsNode = this.findFunctionParameters(declaratorNode);
    const params = paramsNode ? this.parseCParameters(paramsNode) : [];

    // Return type is in the type specifier
    const typeNode = node.childForFieldName("type");
    const returnType = typeNode ? this.getNodeText(typeNode) : null;

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Check for static modifier
    const modifiers: UCEModifier[] = [];
    if (node.children.some((c: SyntaxNode) => c.type === "storage_class_specifier" && c.text === "static")) {
      modifiers.push("static");
    }

    const docComment = this.extractDocComment(node);
    const signature = `${returnType || "void"} ${name}(${params.map(p => `${p.type || ""} ${p.name}`).join(", ")})`;

    return {
      kind: "function",
      name,
      params,
      returnType,
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature: signature.trim(),
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Finds the function name from a declarator node.
   */
  private findFunctionDeclaratorName(declarator: SyntaxNode): SyntaxNode | null {
    if (declarator.type === "function_declarator") {
      const innerDeclarator = declarator.childForFieldName("declarator");
      if (innerDeclarator?.type === "identifier") {
        return innerDeclarator;
      }
      // Could be pointer declarator
      if (innerDeclarator) {
        return this.findFunctionDeclaratorName(innerDeclarator);
      }
    } else if (declarator.type === "pointer_declarator") {
      const innerDeclarator = declarator.childForFieldName("declarator");
      if (innerDeclarator) {
        return this.findFunctionDeclaratorName(innerDeclarator);
      }
    } else if (declarator.type === "identifier") {
      return declarator;
    }
    return null;
  }

  /**
   * Finds the parameters node from a declarator.
   */
  private findFunctionParameters(declarator: SyntaxNode): SyntaxNode | null {
    if (declarator.type === "function_declarator") {
      return declarator.childForFieldName("parameters");
    } else if (declarator.type === "pointer_declarator") {
      const innerDeclarator = declarator.childForFieldName("declarator");
      if (innerDeclarator) {
        return this.findFunctionParameters(innerDeclarator);
      }
    }
    return null;
  }

  /**
   * Parses C function parameters.
   */
  private parseCParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "parameter_declaration") {
        const typeNode = child.childForFieldName("type");
        const declaratorNode = child.childForFieldName("declarator");

        let name = "";
        if (declaratorNode?.type === "identifier") {
          name = declaratorNode.text;
        } else if (declaratorNode?.type === "pointer_declarator") {
          const innerDeclarator = declaratorNode.childForFieldName("declarator");
          name = innerDeclarator?.text ?? "";
        }

        params.push({
          name,
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: false,
          isRest: false,
          defaultValue: null,
        });
      } else if (child.type === "variadic_parameter") {
        params.push({
          name: "...",
          type: "...",
          isOptional: false,
          isRest: true,
          defaultValue: null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a C++ function definition.
   */
  private parseCppFunction(node: SyntaxNode): UCEFunction | null {
    const declaratorNode = node.childForFieldName("declarator");
    if (!declaratorNode) return null;

    // The function name is inside the declarator
    const nameNode = this.findCppFunctionName(declaratorNode);
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Get parameters
    const paramsNode = this.findFunctionParameters(declaratorNode);
    const params = paramsNode ? this.parseCppParameters(paramsNode) : [];

    // Return type
    const typeNode = node.childForFieldName("type");
    const returnType = typeNode ? this.getNodeText(typeNode) : null;

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Check for modifiers
    const modifiers: UCEModifier[] = [];
    if (node.children.some((c: SyntaxNode) => c.type === "storage_class_specifier" && c.text === "static")) {
      modifiers.push("static");
    }
    if (node.children.some((c: SyntaxNode) => c.type === "virtual")) {
      modifiers.push("abstract");
    }
    if (node.children.some((c: SyntaxNode) => c.type === "storage_class_specifier" && c.text === "inline")) {
      modifiers.push("export"); // inline functions are typically visible
    }

    // Check for template
    const typeParams: UCETypeParameter[] = [];
    const templateNode = node.parent?.type === "template_declaration" ? node.parent : null;
    if (templateNode) {
      const templateParams = templateNode.childForFieldName("parameters");
      if (templateParams) {
        for (const param of templateParams.children) {
          if (param.type === "type_parameter_declaration") {
            const paramName = param.children.find((c) => c.type === "type_identifier");
            if (paramName) {
              typeParams.push({
                name: paramName.text,
                constraint: null,
                default: null,
              });
            }
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);
    const signature = `${returnType || "void"} ${name}(${params.map(p => `${p.type || ""} ${p.name}`).join(", ")})`;

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
      signature: signature.trim(),
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Finds the function name from a C++ declarator.
   */
  private findCppFunctionName(declarator: SyntaxNode): SyntaxNode | null {
    if (declarator.type === "function_declarator") {
      const innerDeclarator = declarator.childForFieldName("declarator");
      if (innerDeclarator?.type === "identifier") {
        return innerDeclarator;
      }
      if (innerDeclarator?.type === "qualified_identifier") {
        // Get the last identifier (the function name)
        const nameNode = innerDeclarator.childForFieldName("name");
        return nameNode;
      }
      if (innerDeclarator?.type === "field_identifier") {
        return innerDeclarator;
      }
      if (innerDeclarator) {
        return this.findCppFunctionName(innerDeclarator);
      }
    } else if (declarator.type === "pointer_declarator" || declarator.type === "reference_declarator") {
      const innerDeclarator = declarator.childForFieldName("declarator");
      if (innerDeclarator) {
        return this.findCppFunctionName(innerDeclarator);
      }
    } else if (declarator.type === "identifier") {
      return declarator;
    }
    return null;
  }

  /**
   * Parses C++ function parameters.
   */
  private parseCppParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "parameter_declaration") {
        const typeNode = child.childForFieldName("type");
        const declaratorNode = child.childForFieldName("declarator");
        const defaultValueNode = child.childForFieldName("default_value");

        let name = "";
        if (declaratorNode?.type === "identifier") {
          name = declaratorNode.text;
        } else if (declaratorNode?.type === "pointer_declarator" || declaratorNode?.type === "reference_declarator") {
          const innerDeclarator = declaratorNode.childForFieldName("declarator");
          name = innerDeclarator?.text ?? "";
        }

        params.push({
          name,
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: defaultValueNode !== null,
          isRest: false,
          defaultValue: defaultValueNode ? this.getNodeText(defaultValueNode) : null,
        });
      } else if (child.type === "variadic_parameter_declaration") {
        params.push({
          name: "...",
          type: "...",
          isOptional: false,
          isRest: true,
          defaultValue: null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a C# method declaration.
   */
  private parseCSharpFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseCSharpParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode) : null;

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Extract modifiers
    const modifiers: UCEModifier[] = [];
    for (const child of node.children) {
      if (child.type === "modifier") {
        const modText = child.text;
        if (modText === "public") modifiers.push("public");
        if (modText === "private") modifiers.push("private");
        if (modText === "protected") modifiers.push("protected");
        if (modText === "static") modifiers.push("static");
        if (modText === "readonly") modifiers.push("readonly");
        if (modText === "abstract") modifiers.push("abstract");
        if (modText === "virtual") modifiers.push("abstract"); // C# virtual similar to abstract
        if (modText === "override") modifiers.push("override");
        if (modText === "async") modifiers.push("async");
      }
    }

    const docComment = this.extractDocComment(node);
    const signature = `${modifiers.filter(m => ["public", "private", "protected", "static"].includes(m)).join(" ")} ${returnType || "void"} ${name}(${params.map(p => `${p.type || "object"} ${p.name}`).join(", ")})`;

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
      signature: signature.trim(),
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses C# method parameters.
   */
  private parseCSharpParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "parameter") {
        const typeNode = child.childForFieldName("type");
        const nameNode = child.childForFieldName("name");
        const defaultValueNode = child.childForFieldName("default_value");

        // Check for params keyword (variadic)
        const isParams = child.children.some((c) => c.type === "modifier" && c.text === "params");

        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: defaultValueNode !== null,
          isRest: isParams,
          defaultValue: defaultValueNode ? this.getNodeText(defaultValueNode) : null,
        });
      }
    }

    return params;
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
    const nodeTypes = CLASS_NODE_TYPES[this.language] ?? CLASS_NODE_TYPES["typescript"] ?? [];

    this.findNodes(rootNode, nodeTypes).forEach((node) => {
      // For Kotlin, skip class_declarations that have the 'interface' keyword (those are interfaces)
      if (this.language === "kotlin" && node.type === "class_declaration") {
        const hasInterfaceKeyword = node.children.some((c: SyntaxNode) => c.type === "interface");
        if (hasInterfaceKeyword) {
          return; // Skip interface declarations
        }
      }

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
    // Handle language-specific class parsing
    switch (this.language) {
      case "go":
        return this.parseGoStruct(node);
      case "rust":
        return this.parseRustStruct(node);
      case "python":
        return this.parsePythonClass(node);
      case "java":
        return this.parseJavaClass(node);
      case "c":
        return this.parseCStruct(node);
      case "cpp":
        return this.parseCppClass(node);
      case "csharp":
        return this.parseCSharpClass(node);
      case "kotlin":
        return this.parseKotlinClass(node);
      case "swift":
        return this.parseSwiftClass(node);
      case "dart":
        return this.parseDartClass(node);
      case "ruby":
        return this.parseRubyClass(node);
      case "php":
        return this.parsePhpClass(node);
      case "scala":
        return this.parseScalaClass(node);
      case "haskell":
        return this.parseHaskellClass(node);
      case "elixir":
        return this.parseElixirModule(node);
      default:
        return this.parseTypeScriptClass(node);
    }
  }

  /**
   * Parses a TypeScript/JavaScript class node.
   */
  private parseTypeScriptClass(node: SyntaxNode): UCEClass | null {
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
   * Parses a Go struct (type_spec with struct_type).
   */
  private parseGoStruct(node: SyntaxNode): UCEClass | null {
    // Go structs are defined as: type Name struct { ... }
    // The type_spec node contains the name and type
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Check if this is a struct type
    const typeNode = node.childForFieldName("type");
    if (!typeNode || typeNode.type !== "struct_type") {
      return null; // Not a struct, might be an interface
    }

    const properties: UCEProperty[] = [];
    const methods: UCEMethod[] = []; // Methods are defined separately in Go

    // Parse struct fields
    const fieldListNode = typeNode.children.find((c) => c.type === "field_declaration_list");
    if (fieldListNode) {
      for (const field of fieldListNode.children) {
        if (field.type === "field_declaration") {
          const fieldNames = field.children.filter((c) => c.type === "field_identifier");
          const fieldType = field.children.find((c) =>
            c.type === "type_identifier" ||
            c.type === "pointer_type" ||
            c.type === "slice_type" ||
            c.type === "array_type"
          );

          for (const fieldName of fieldNames) {
            const fieldNameText = fieldName.text;
            properties.push({
              kind: "property",
              name: fieldNameText,
              type: fieldType ? this.getNodeText(fieldType) : null,
              visibility: fieldNameText.length > 0 && fieldNameText[0] === fieldNameText[0]?.toUpperCase() ? "public" : "private",
              isStatic: false,
              isReadonly: false,
              isOptional: false,
              defaultValue: null,
              location: this.getLocation(field),
              docComment: null,
            });
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);
    const isExported = name.length > 0 && name[0] === name[0]?.toUpperCase();

    return {
      kind: "class",
      name,
      typeParams: [],
      extends: null,
      implements: [],
      methods,
      properties,
      constructor: null,
      location: this.getLocation(node),
      modifiers: isExported ? ["export"] : [],
      docComment,
      isAbstract: false,
    };
  }

  /**
   * Parses a Rust struct or impl.
   */
  private parseRustStruct(node: SyntaxNode): UCEClass | null {
    if (node.type === "struct_item") {
      const nameNode = node.childForFieldName("name");
      const name = nameNode?.text ?? "";

      if (!name) return null;

      const properties: UCEProperty[] = [];

      // Parse struct fields
      const bodyNode = node.childForFieldName("body");
      if (bodyNode) {
        for (const field of bodyNode.children) {
          if (field.type === "field_declaration") {
            const fieldName = field.childForFieldName("name");
            const fieldType = field.childForFieldName("type");
            const visibility = field.children.find((c: SyntaxNode) => c.type === "visibility_modifier");

            properties.push({
              kind: "property",
              name: fieldName?.text ?? "",
              type: fieldType ? this.getNodeText(fieldType) : null,
              visibility: visibility ? "public" : "private",
              isStatic: false,
              isReadonly: false,
              isOptional: false,
              defaultValue: null,
              location: this.getLocation(field),
              docComment: null,
            });
          }
        }
      }

      const typeParamsNode = node.childForFieldName("type_parameters");
      const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];
      const docComment = this.extractDocComment(node);
      const visibility = node.children.find((c: SyntaxNode) => c.type === "visibility_modifier");

      return {
        kind: "class",
        name,
        typeParams,
        extends: null,
        implements: [],
        methods: [],
        properties,
        constructor: null,
        location: this.getLocation(node),
        modifiers: visibility ? ["export"] : [],
        docComment,
        isAbstract: false,
      };
    } else if (node.type === "impl_item") {
      // impl blocks contain methods for a type
      const typeNode = node.childForFieldName("type");
      const name = typeNode?.text ?? "";

      if (!name) return null;

      const methods: UCEMethod[] = [];
      const bodyNode = node.childForFieldName("body");

      if (bodyNode) {
        for (const item of bodyNode.children) {
          if (item.type === "function_item") {
            const fn = this.parseRustFunction(item);
            if (fn) {
              methods.push({
                kind: "method",
                name: fn.name,
                params: fn.params,
                returnType: fn.returnType,
                typeParams: fn.typeParams,
                body: fn.body,
                location: fn.location,
                modifiers: fn.modifiers,
                docComment: fn.docComment,
                signature: fn.signature,
                visibility: fn.modifiers.includes("public") ? "public" : "private",
                isStatic: !fn.params.some((p) => p.name === "self"),
                isAbstract: false,
                isGetter: false,
                isSetter: false,
              });
            }
          }
        }
      }

      return {
        kind: "class",
        name: `impl ${name}`,
        typeParams: [],
        extends: null,
        implements: [],
        methods,
        properties: [],
        constructor: null,
        location: this.getLocation(node),
        modifiers: [],
        docComment: this.extractDocComment(node),
        isAbstract: false,
      };
    }

    return null;
  }

  /**
   * Parses a Python class definition.
   */
  private parsePythonClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Parse superclass
    const superclassNode = node.childForFieldName("superclasses");
    const extendsList: string[] = [];
    if (superclassNode) {
      for (const child of superclassNode.children) {
        if (child.type === "identifier" || child.type === "attribute") {
          extendsList.push(child.text);
        }
      }
    }

    const bodyNode = node.childForFieldName("body");
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "function_definition") {
          const fn = this.parsePythonFunction(child);
          if (fn) {
            const method: UCEMethod = {
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: fn.name.startsWith("_") ? "private" : "public",
              isStatic: fn.modifiers.includes("static"),
              isAbstract: fn.modifiers.includes("abstract"),
              isGetter: fn.modifiers.includes("readonly"),
              isSetter: false,
            };

            if (fn.name === "__init__") {
              constructorMethod = method;
            } else {
              methods.push(method);
            }
          }
        } else if (child.type === "expression_statement") {
          // Class-level variable assignments
          const assignment = child.children.find((c) => c.type === "assignment");
          if (assignment) {
            const leftNode = assignment.childForFieldName("left");
            const rightNode = assignment.childForFieldName("right");
            if (leftNode?.type === "identifier") {
              properties.push({
                kind: "property",
                name: leftNode.text,
                type: null,
                visibility: leftNode.text.startsWith("_") ? "private" : "public",
                isStatic: true, // Class-level
                isReadonly: false,
                isOptional: false,
                defaultValue: rightNode ? this.getNodeText(rightNode) : null,
                location: this.getLocation(child),
                docComment: null,
              });
            }
          }
        }
      }
    }

    const docComment = this.extractPythonDocstring(bodyNode);

    return {
      kind: "class",
      name,
      typeParams: [],
      extends: extendsList[0] ?? null,
      implements: extendsList.slice(1),
      methods,
      properties,
      constructor: constructorMethod,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
      isAbstract: extendsList.some((e) => e.includes("ABC")),
    };
  }

  /**
   * Parses a Java class declaration.
   */
  private parseJavaClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Parse extends
    const superclassNode = node.childForFieldName("superclass");
    const extendsClass = superclassNode?.text ?? null;

    // Parse implements
    const interfacesNode = node.childForFieldName("interfaces");
    const implementsList: string[] = [];
    if (interfacesNode) {
      for (const child of interfacesNode.children) {
        if (child.type === "type_identifier" || child.type === "generic_type") {
          implementsList.push(child.text);
        }
      }
    }

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "method_declaration") {
          const fn = this.parseJavaFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: fn.modifiers.includes("private")
                ? "private"
                : fn.modifiers.includes("protected")
                  ? "protected"
                  : "public",
              isStatic: fn.modifiers.includes("static"),
              isAbstract: fn.modifiers.includes("abstract"),
              isGetter: fn.name.startsWith("get"),
              isSetter: fn.name.startsWith("set"),
            });
          }
        } else if (child.type === "constructor_declaration") {
          const fn = this.parseJavaFunction(child);
          if (fn) {
            constructorMethod = {
              kind: "method",
              name: "constructor",
              params: fn.params,
              returnType: null,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: "public",
              isStatic: false,
              isAbstract: false,
              isGetter: false,
              isSetter: false,
            };
          }
        } else if (child.type === "field_declaration") {
          const typeNode = child.childForFieldName("type");
          const declarators = child.children.filter((c: SyntaxNode) => c.type === "variable_declarator");

          for (const decl of declarators) {
            const fieldName = decl.childForFieldName("name");
            const fieldValue = decl.childForFieldName("value");

            const modifierNode = child.children.find((c: SyntaxNode) => c.type === "modifiers");
            const modifiers: string[] = [];
            if (modifierNode) {
              for (const mod of modifierNode.children) {
                modifiers.push(mod.text);
              }
            }

            properties.push({
              kind: "property",
              name: fieldName?.text ?? "",
              type: typeNode ? this.getNodeText(typeNode) : null,
              visibility: modifiers.includes("private")
                ? "private"
                : modifiers.includes("protected")
                  ? "protected"
                  : "public",
              isStatic: modifiers.includes("static"),
              isReadonly: modifiers.includes("final"),
              isOptional: false,
              defaultValue: fieldValue ? this.getNodeText(fieldValue) : null,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    // Extract modifiers
    const modifiers: UCEModifier[] = [];
    const modifierNode = node.children.find((c: SyntaxNode) => c.type === "modifiers");
    if (modifierNode) {
      for (const mod of modifierNode.children) {
        if (mod.text === "public") modifiers.push("export");
        if (mod.text === "abstract") modifiers.push("abstract");
      }
    }

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
   * Parses a C struct specifier.
   */
  private parseCStruct(node: SyntaxNode): UCEClass | null {
    // C structs: struct Name { ... }
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const properties: UCEProperty[] = [];

    // Parse struct fields from the body
    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "field_declaration") {
          const typeNode = child.childForFieldName("type");
          const declaratorNode = child.childForFieldName("declarator");

          let fieldName = "";
          if (declaratorNode?.type === "field_identifier") {
            fieldName = declaratorNode.text;
          } else if (declaratorNode?.type === "pointer_declarator") {
            const innerDecl = declaratorNode.childForFieldName("declarator");
            fieldName = innerDecl?.text ?? "";
          } else if (declaratorNode?.type === "array_declarator") {
            const innerDecl = declaratorNode.childForFieldName("declarator");
            fieldName = innerDecl?.text ?? "";
          }

          if (fieldName) {
            properties.push({
              kind: "property",
              name: fieldName,
              type: typeNode ? this.getNodeText(typeNode) : null,
              visibility: "public", // C structs are always public
              isStatic: false,
              isReadonly: false,
              isOptional: false,
              defaultValue: null,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams: [],
      extends: null,
      implements: [],
      methods: [],
      properties,
      constructor: null,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
      isAbstract: false,
    };
  }

  /**
   * Parses a C++ class or struct specifier.
   */
  private parseCppClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const isStruct = node.type === "struct_specifier";
    const properties: UCEProperty[] = [];
    const methods: UCEMethod[] = [];

    // Parse base classes
    const baseClauseNode = node.children.find((c) => c.type === "base_class_clause");
    const extendsList: string[] = [];
    if (baseClauseNode) {
      for (const child of baseClauseNode.children) {
        if (child.type === "type_identifier" || child.type === "qualified_identifier") {
          extendsList.push(child.text);
        }
      }
    }

    // Parse body
    const bodyNode = node.childForFieldName("body");
    let currentVisibility: UCEVisibility = isStruct ? "public" : "private";

    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "access_specifier") {
          const specText = child.text.replace(":", "").trim();
          if (specText === "public") currentVisibility = "public";
          else if (specText === "private") currentVisibility = "private";
          else if (specText === "protected") currentVisibility = "protected";
        } else if (child.type === "field_declaration") {
          const typeNode = child.childForFieldName("type");
          const declaratorNode = child.childForFieldName("declarator");

          let fieldName = "";
          if (declaratorNode?.type === "field_identifier") {
            fieldName = declaratorNode.text;
          } else if (declaratorNode) {
            // Could be pointer or array
            const innerDecl = declaratorNode.childForFieldName("declarator");
            fieldName = innerDecl?.text ?? declaratorNode.text ?? "";
          }

          if (fieldName) {
            const isStatic = child.children.some((c: SyntaxNode) =>
              c.type === "storage_class_specifier" && c.text === "static"
            );
            const isConst = child.children.some((c: SyntaxNode) =>
              c.type === "type_qualifier" && c.text === "const"
            );

            properties.push({
              kind: "property",
              name: fieldName,
              type: typeNode ? this.getNodeText(typeNode) : null,
              visibility: currentVisibility,
              isStatic,
              isReadonly: isConst,
              isOptional: false,
              defaultValue: null,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        } else if (child.type === "function_definition" || child.type === "declaration") {
          // Method definition or declaration
          const fn = this.parseCppFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: currentVisibility,
              isStatic: fn.modifiers.includes("static"),
              isAbstract: fn.modifiers.includes("abstract"),
              isGetter: false,
              isSetter: false,
            });
          }
        }
      }
    }

    // Check for template
    const typeParams: UCETypeParameter[] = [];
    const templateNode = node.parent?.type === "template_declaration" ? node.parent : null;
    if (templateNode) {
      const templateParams = templateNode.childForFieldName("parameters");
      if (templateParams) {
        for (const param of templateParams.children) {
          if (param.type === "type_parameter_declaration") {
            const paramName = param.children.find((c) => c.type === "type_identifier");
            if (paramName) {
              typeParams.push({
                name: paramName.text,
                constraint: null,
                default: null,
              });
            }
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams,
      extends: extendsList[0] ?? null,
      implements: extendsList.slice(1),
      methods,
      properties,
      constructor: null,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
      isAbstract: false,
    };
  }

  /**
   * Parses a C# class or struct declaration.
   */
  private parseCSharpClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Parse base types
    const baseListNode = node.childForFieldName("bases");
    const extendsList: string[] = [];
    if (baseListNode) {
      for (const child of baseListNode.children) {
        if (child.type === "identifier" || child.type === "generic_name" || child.type === "qualified_name") {
          extendsList.push(child.text);
        }
      }
    }

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "method_declaration") {
          const fn = this.parseCSharpFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: fn.modifiers.includes("private")
                ? "private"
                : fn.modifiers.includes("protected")
                  ? "protected"
                  : "public",
              isStatic: fn.modifiers.includes("static"),
              isAbstract: fn.modifiers.includes("abstract"),
              isGetter: false,
              isSetter: false,
            });
          }
        } else if (child.type === "constructor_declaration") {
          const fn = this.parseCSharpFunction(child);
          if (fn) {
            constructorMethod = {
              kind: "method",
              name: "constructor",
              params: fn.params,
              returnType: null,
              typeParams: [],
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: "public",
              isStatic: false,
              isAbstract: false,
              isGetter: false,
              isSetter: false,
            };
          }
        } else if (child.type === "field_declaration") {
          const typeNode = child.childForFieldName("type");
          const declarationNode = child.childForFieldName("declaration");

          // Extract modifiers
          const fieldModifiers: string[] = [];
          for (const mod of child.children) {
            if (mod.type === "modifier") {
              fieldModifiers.push(mod.text);
            }
          }

          if (declarationNode) {
            for (const varDecl of declarationNode.children) {
              if (varDecl.type === "variable_declarator") {
                const fieldName = varDecl.childForFieldName("name");
                const fieldValue = varDecl.childForFieldName("value");

                if (fieldName) {
                  properties.push({
                    kind: "property",
                    name: fieldName.text,
                    type: typeNode ? this.getNodeText(typeNode) : null,
                    visibility: fieldModifiers.includes("private")
                      ? "private"
                      : fieldModifiers.includes("protected")
                        ? "protected"
                        : "public",
                    isStatic: fieldModifiers.includes("static"),
                    isReadonly: fieldModifiers.includes("readonly"),
                    isOptional: false,
                    defaultValue: fieldValue ? this.getNodeText(fieldValue) : null,
                    location: this.getLocation(child),
                    docComment: null,
                  });
                }
              }
            }
          }
        } else if (child.type === "property_declaration") {
          const typeNode = child.childForFieldName("type");
          const propName = child.childForFieldName("name");

          // Extract modifiers
          const propModifiers: string[] = [];
          for (const mod of child.children) {
            if (mod.type === "modifier") {
              propModifiers.push(mod.text);
            }
          }

          if (propName) {
            properties.push({
              kind: "property",
              name: propName.text,
              type: typeNode ? this.getNodeText(typeNode) : null,
              visibility: propModifiers.includes("private")
                ? "private"
                : propModifiers.includes("protected")
                  ? "protected"
                  : "public",
              isStatic: propModifiers.includes("static"),
              isReadonly: false,
              isOptional: false,
              defaultValue: null,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    // Extract class modifiers
    const modifiers: UCEModifier[] = [];
    for (const child of node.children) {
      if (child.type === "modifier") {
        const modText = child.text;
        if (modText === "public") modifiers.push("export");
        if (modText === "abstract") modifiers.push("abstract");
        if (modText === "static") modifiers.push("static");
        if (modText === "sealed") modifiers.push("readonly");
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams,
      extends: extendsList[0] ?? null,
      implements: extendsList.slice(1),
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
    const nodeTypes = INTERFACE_NODE_TYPES[this.language] ?? INTERFACE_NODE_TYPES["typescript"] ?? [];

    // Skip if language doesn't have interfaces
    if (!nodeTypes || nodeTypes.length === 0) {
      return interfaces;
    }

    this.findNodes(rootNode, nodeTypes).forEach((node) => {
      // For Kotlin, filter to only class_declarations that have the 'interface' keyword
      if (this.language === "kotlin" && node.type === "class_declaration") {
        const hasInterfaceKeyword = node.children.some((c: SyntaxNode) => c.type === "interface");
        if (!hasInterfaceKeyword) {
          return; // Skip non-interface class declarations
        }
      }

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
    // Handle language-specific interface parsing
    switch (this.language) {
      case "go":
        return this.parseGoInterface(node);
      case "rust":
        return this.parseRustTrait(node);
      case "java":
        return this.parseJavaInterface(node);
      case "csharp":
        return this.parseCSharpInterface(node);
      case "kotlin":
        return this.parseKotlinInterface(node);
      case "swift":
        return this.parseSwiftProtocol(node);
      case "php":
        return this.parsePhpInterface(node);
      case "scala":
        return this.parseScalaTrait(node);
      case "haskell":
        return this.parseHaskellTypeClass(node);
      default:
        return this.parseTypeScriptInterface(node);
    }
  }

  /**
   * Parses a TypeScript interface declaration.
   */
  private parseTypeScriptInterface(node: SyntaxNode): UCEInterface | null {
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
   * Parses a Go interface (type_spec with interface_type).
   */
  private parseGoInterface(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Check if this is an interface type
    const typeNode = node.childForFieldName("type");
    if (!typeNode || typeNode.type !== "interface_type") {
      return null; // Not an interface
    }

    const methods: UCEInterfaceMethod[] = [];
    const extendsList: string[] = [];

    // Parse interface methods
    for (const child of typeNode.children) {
      if (child.type === "method_spec") {
        const methodName = child.childForFieldName("name");
        const paramsNode = child.childForFieldName("parameters");
        const resultNode = child.childForFieldName("result");

        methods.push({
          kind: "method",
          name: methodName?.text ?? "",
          params: paramsNode ? this.parseGoParameters(paramsNode) : [],
          returnType: resultNode ? this.getNodeText(resultNode) : null,
          typeParams: [],
          signature: `${methodName?.text ?? ""}(${paramsNode ? this.getNodeText(paramsNode) : ""})${resultNode ? " " + this.getNodeText(resultNode) : ""}`,
          isOptional: false,
          location: this.getLocation(child),
          docComment: null,
        });
      } else if (child.type === "type_identifier") {
        // Embedded interface
        extendsList.push(child.text);
      }
    }

    const docComment = this.extractDocComment(node);
    const isExported = name.length > 0 && name[0] === name[0]?.toUpperCase();

    return {
      kind: "interface",
      name,
      typeParams: [],
      extends: extendsList,
      properties: [],
      methods,
      location: this.getLocation(node),
      modifiers: isExported ? ["export"] : [],
      docComment,
    };
  }

  /**
   * Parses a Rust trait definition.
   */
  private parseRustTrait(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const methods: UCEInterfaceMethod[] = [];
    const extendsList: string[] = [];

    // Parse trait bounds (super traits)
    const boundsNode = node.childForFieldName("bounds");
    if (boundsNode) {
      for (const child of boundsNode.children) {
        if (child.type === "type_identifier" || child.type === "generic_type") {
          extendsList.push(child.text);
        }
      }
    }

    // Parse trait items
    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
      for (const item of bodyNode.children) {
        if (item.type === "function_signature_item" || item.type === "function_item") {
          const methodName = item.childForFieldName("name");
          const paramsNode = item.childForFieldName("parameters");
          const returnTypeNode = item.childForFieldName("return_type");

          methods.push({
            kind: "method",
            name: methodName?.text ?? "",
            params: paramsNode ? this.parseRustParameters(paramsNode) : [],
            returnType: returnTypeNode ? this.getNodeText(returnTypeNode).replace(/^->\s*/, "") : null,
            typeParams: [],
            signature: `fn ${methodName?.text ?? ""}(...)`,
            isOptional: false,
            location: this.getLocation(item),
            docComment: null,
          });
        }
      }
    }

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];
    const visibility = node.children.find((c: SyntaxNode) => c.type === "visibility_modifier");
    const docComment = this.extractDocComment(node);

    return {
      kind: "interface",
      name,
      typeParams,
      extends: extendsList,
      properties: [],
      methods,
      location: this.getLocation(node),
      modifiers: visibility ? ["export"] : [],
      docComment,
    };
  }

  /**
   * Parses a Java interface declaration.
   */
  private parseJavaInterface(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Parse extends
    const extendsNode = node.childForFieldName("extends_interfaces");
    const extendsList: string[] = [];
    if (extendsNode) {
      for (const child of extendsNode.children) {
        if (child.type === "type_identifier" || child.type === "generic_type") {
          extendsList.push(child.text);
        }
      }
    }

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const methods: UCEInterfaceMethod[] = [];
    const properties: UCEInterfaceProperty[] = [];

    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "method_declaration") {
          const methodName = child.childForFieldName("name");
          const paramsNode = child.childForFieldName("parameters");
          const returnTypeNode = child.childForFieldName("type");

          methods.push({
            kind: "method",
            name: methodName?.text ?? "",
            params: paramsNode ? this.parseJavaParameters(paramsNode) : [],
            returnType: returnTypeNode ? this.getNodeText(returnTypeNode) : null,
            typeParams: [],
            signature: `${returnTypeNode ? this.getNodeText(returnTypeNode) : "void"} ${methodName?.text ?? ""}(...)`,
            isOptional: false,
            location: this.getLocation(child),
            docComment: null,
          });
        } else if (child.type === "constant_declaration") {
          const typeNode = child.childForFieldName("type");
          const declarators = child.children.filter((c: SyntaxNode) => c.type === "variable_declarator");

          for (const decl of declarators) {
            const fieldName = decl.childForFieldName("name");
            properties.push({
              kind: "property",
              name: fieldName?.text ?? "",
              type: typeNode ? this.getNodeText(typeNode) : null,
              isReadonly: true,
              isOptional: false,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    // Extract modifiers
    const modifiers: UCEModifier[] = [];
    const modifierNode = node.children.find((c: SyntaxNode) => c.type === "modifiers");
    if (modifierNode) {
      for (const mod of modifierNode.children) {
        if (mod.text === "public") modifiers.push("export");
      }
    }

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
   * Parses a C# interface declaration.
   */
  private parseCSharpInterface(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Parse base interfaces
    const baseListNode = node.childForFieldName("bases");
    const extendsList: string[] = [];
    if (baseListNode) {
      for (const child of baseListNode.children) {
        if (child.type === "identifier" || child.type === "generic_name" || child.type === "qualified_name") {
          extendsList.push(child.text);
        }
      }
    }

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const methods: UCEInterfaceMethod[] = [];
    const properties: UCEInterfaceProperty[] = [];

    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "method_declaration") {
          const methodName = child.childForFieldName("name");
          const paramsNode = child.childForFieldName("parameters");
          const returnTypeNode = child.childForFieldName("type");

          methods.push({
            kind: "method",
            name: methodName?.text ?? "",
            params: paramsNode ? this.parseCSharpParameters(paramsNode) : [],
            returnType: returnTypeNode ? this.getNodeText(returnTypeNode) : null,
            typeParams: [],
            signature: `${returnTypeNode ? this.getNodeText(returnTypeNode) : "void"} ${methodName?.text ?? ""}(...)`,
            isOptional: false,
            location: this.getLocation(child),
            docComment: null,
          });
        } else if (child.type === "property_declaration") {
          const typeNode = child.childForFieldName("type");
          const propName = child.childForFieldName("name");

          if (propName) {
            properties.push({
              kind: "property",
              name: propName.text,
              type: typeNode ? this.getNodeText(typeNode) : null,
              isReadonly: false,
              isOptional: false,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    // Extract modifiers
    const modifiers: UCEModifier[] = [];
    for (const child of node.children) {
      if (child.type === "modifier") {
        if (child.text === "public") modifiers.push("export");
      }
    }

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

  // ===========================================================================
  // Kotlin Language Support
  // ===========================================================================

  /**
   * Parses a Kotlin function declaration.
   */
  private parseKotlinFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name") ?? node.children.find((c) => c.type === "simple_identifier");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("value_parameters") ?? node.children.find((c) => c.type === "function_value_parameters");
    const params = paramsNode ? this.parseKotlinParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("type") ?? node.children.find((c) => c.type === "type_identifier" || c.type === "user_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode) : null;

    const typeParamsNode = node.childForFieldName("type_parameters") ?? node.children.find((c) => c.type === "type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.childForFieldName("body") ?? node.children.find((c) => c.type === "function_body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Extract modifiers
    const modifiers: UCEModifier[] = [];
    const modifierList = node.children.filter((c: SyntaxNode) => c.type === "modifiers" || c.type === "modifier");
    for (const modNode of modifierList) {
      const modText = modNode.text;
      if (modText.includes("public")) modifiers.push("public");
      if (modText.includes("private")) modifiers.push("private");
      if (modText.includes("protected")) modifiers.push("protected");
      if (modText.includes("internal")) modifiers.push("public"); // Map internal to public
      if (modText.includes("suspend")) modifiers.push("async");
      if (modText.includes("abstract")) modifiers.push("abstract");
      if (modText.includes("override")) modifiers.push("override");
    }

    const docComment = this.extractDocComment(node);
    const signature = `fun ${name}(${params.map(p => `${p.name}: ${p.type || "Any"}`).join(", ")}): ${returnType || "Unit"}`;

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
      signature: signature.trim(),
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode ?? null) : 0,
    };
  }

  /**
   * Parses Kotlin function parameters.
   */
  private parseKotlinParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "parameter" || child.type === "function_value_parameter") {
        const nameNode = child.children.find((c) => c.type === "simple_identifier");
        const typeNode = child.childForFieldName("type") ?? child.children.find((c) => c.type === "user_type" || c.type === "type_identifier");
        const defaultValueNode = child.children.find((c) => c.type === "expression" || c.previousSibling?.text === "=");

        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: defaultValueNode !== null,
          isRest: false,
          defaultValue: defaultValueNode ? this.getNodeText(defaultValueNode) : null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a Kotlin class or object declaration.
   */
  private parseKotlinClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name") ?? node.children.find((c) => c.type === "type_identifier" || c.type === "simple_identifier");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Parse superclass/interfaces
    const delegationSpecifiers = node.children.find((c) => c.type === "delegation_specifiers");
    const extendsList: string[] = [];
    if (delegationSpecifiers) {
      for (const child of delegationSpecifiers.children) {
        if (child.type === "delegation_specifier" || child.type === "user_type") {
          const text = child.text ?? "";
          extendsList.push(text.split("(")[0] ?? text); // Remove constructor call
        }
      }
    }

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    const bodyNode = node.children.find((c) => c.type === "class_body");
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    // Parse primary constructor parameters as properties
    const primaryConstructor = node.children.find((c) => c.type === "primary_constructor");
    if (primaryConstructor) {
      const classParams = primaryConstructor.children.find((c) => c.type === "class_parameters");
      if (classParams) {
        for (const param of classParams.children) {
          if (param.type === "class_parameter") {
            const propName = param.children.find((c) => c.type === "simple_identifier");
            const propType = param.children.find((c) => c.type === "user_type" || c.type === "type_identifier");
            const isVal = param.children.some((c) => c.text === "val");
            const isVar = param.children.some((c) => c.text === "var");

            if (propName && (isVal || isVar)) {
              properties.push({
                kind: "property",
                name: propName.text,
                type: propType ? this.getNodeText(propType) : null,
                visibility: "public",
                isStatic: false,
                isReadonly: isVal,
                isOptional: false,
                defaultValue: null,
                location: this.getLocation(param),
                docComment: null,
              });
            }
          }
        }
      }
    }

    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "function_declaration") {
          const fn = this.parseKotlinFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: fn.modifiers.includes("private") ? "private" : fn.modifiers.includes("protected") ? "protected" : "public",
              isStatic: false,
              isAbstract: fn.modifiers.includes("abstract"),
              isGetter: false,
              isSetter: false,
            });
          }
        } else if (child.type === "property_declaration") {
          const propName = child.children.find((c) => c.type === "variable_declaration")?.children.find((c) => c.type === "simple_identifier");
          const propType = child.children.find((c) => c.type === "user_type" || c.type === "type_identifier");
          const isVal = child.children.some((c) => c.text === "val");

          if (propName) {
            properties.push({
              kind: "property",
              name: propName.text,
              type: propType ? this.getNodeText(propType) : null,
              visibility: "public",
              isStatic: false,
              isReadonly: isVal,
              isOptional: false,
              defaultValue: null,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    // Extract class modifiers
    const modifiers: UCEModifier[] = [];
    const modifierList = node.children.filter((c: SyntaxNode) => c.type === "modifiers");
    for (const modNode of modifierList) {
      const modText = modNode.text;
      if (modText.includes("public") || modText.includes("internal")) modifiers.push("export");
      if (modText.includes("abstract")) modifiers.push("abstract");
      if (modText.includes("data")) modifiers.push("readonly");
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams,
      extends: extendsList[0] ?? null,
      implements: extendsList.slice(1),
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
   * Parses a Kotlin interface declaration.
   */
  private parseKotlinInterface(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name") ?? node.children.find((c) => c.type === "type_identifier");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const typeParamsNode = node.childForFieldName("type_parameters");
    const typeParams = typeParamsNode ? this.parseTypeParameters(typeParamsNode) : [];

    // Parse extends
    const delegationSpecifiers = node.children.find((c) => c.type === "delegation_specifiers");
    const extendsList: string[] = [];
    if (delegationSpecifiers) {
      for (const child of delegationSpecifiers.children) {
        if (child.type === "user_type") {
          extendsList.push(child.text);
        }
      }
    }

    const methods: UCEInterfaceMethod[] = [];
    const properties: UCEInterfaceProperty[] = [];

    const bodyNode = node.children.find((c) => c.type === "class_body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "function_declaration") {
          const fn = this.parseKotlinFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              signature: fn.signature,
              isOptional: false,
              location: fn.location,
              docComment: fn.docComment,
            });
          }
        } else if (child.type === "property_declaration") {
          const propName = child.children.find((c) => c.type === "variable_declaration")?.children.find((c) => c.type === "simple_identifier");
          const propType = child.children.find((c) => c.type === "user_type" || c.type === "type_identifier");

          if (propName) {
            properties.push({
              kind: "property",
              name: propName.text,
              type: propType ? this.getNodeText(propType) : null,
              isReadonly: false,
              isOptional: false,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "interface",
      name,
      typeParams,
      extends: extendsList,
      properties,
      methods,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
    };
  }

  // ===========================================================================
  // Swift Language Support
  // ===========================================================================

  /**
   * Parses a Swift function declaration.
   */
  private parseSwiftFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name") ?? node.children.find((c) => c.type === "simple_identifier");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters") ?? node.children.find((c) => c.type === "parameter_clause");
    const params = paramsNode ? this.parseSwiftParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("return_type") ?? node.children.find((c) => c.type === "type_identifier" || c.type === "user_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode).replace(/^->\s*/, "") : null;

    const bodyNode = node.childForFieldName("body") ?? node.children.find((c) => c.type === "function_body" || c.type === "code_block");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Extract modifiers
    const modifiers: UCEModifier[] = [];
    for (const child of node.children) {
      if (child.type === "modifiers" || child.type === "modifier") {
        const modText = child.text;
        if (modText.includes("public")) modifiers.push("public");
        if (modText.includes("private")) modifiers.push("private");
        if (modText.includes("fileprivate")) modifiers.push("private");
        if (modText.includes("internal")) modifiers.push("public");
        if (modText.includes("static")) modifiers.push("static");
        if (modText.includes("class")) modifiers.push("static");
        if (modText.includes("async")) modifiers.push("async");
        if (modText.includes("override")) modifiers.push("override");
      }
    }

    const docComment = this.extractDocComment(node);
    const signature = `func ${name}(${params.map(p => `${p.name}: ${p.type || "Any"}`).join(", ")})${returnType ? ` -> ${returnType}` : ""}`;

    return {
      kind: "function",
      name,
      params,
      returnType,
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature: signature.trim(),
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode ?? null) : 0,
    };
  }

  /**
   * Parses Swift function parameters.
   */
  private parseSwiftParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "parameter") {
        const externalName = child.children.find((c, i) => c.type === "simple_identifier" && i === 0);
        const internalName = child.children.filter((c) => c.type === "simple_identifier")[1] ?? externalName;
        const typeNode = child.children.find((c) => c.type === "type_identifier" || c.type === "user_type" || c.type === "optional_type");
        const defaultValueNode = child.children.find((c) => c.type === "expression" || c.previousSibling?.text === "=");

        params.push({
          name: internalName?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: typeNode?.type === "optional_type" || defaultValueNode !== null,
          isRest: child.children.some((c) => c.text === "..."),
          defaultValue: defaultValueNode ? this.getNodeText(defaultValueNode) : null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a Swift class or struct declaration.
   */
  private parseSwiftClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name") ?? node.children.find((c) => c.type === "type_identifier");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const isStruct = node.type === "struct_declaration";

    // Parse inheritance
    const inheritanceClause = node.children.find((c) => c.type === "inheritance_clause" || c.type === "type_inheritance_clause");
    const extendsList: string[] = [];
    if (inheritanceClause) {
      for (const child of inheritanceClause.children) {
        if (child.type === "type_identifier" || child.type === "user_type") {
          extendsList.push(child.text);
        }
      }
    }

    const bodyNode = node.children.find((c) => c.type === "class_body" || c.type === "struct_body");
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "function_declaration") {
          const fn = this.parseSwiftFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: fn.modifiers.includes("private") ? "private" : "public",
              isStatic: fn.modifiers.includes("static"),
              isAbstract: false,
              isGetter: false,
              isSetter: false,
            });
          }
        } else if (child.type === "init_declaration") {
          const fn = this.parseSwiftFunction(child);
          if (fn) {
            constructorMethod = {
              kind: "method",
              name: "init",
              params: fn.params,
              returnType: null,
              typeParams: [],
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: "public",
              isStatic: false,
              isAbstract: false,
              isGetter: false,
              isSetter: false,
            };
          }
        } else if (child.type === "property_declaration" || child.type === "variable_declaration") {
          const propName = child.children.find((c) => c.type === "pattern")?.text ?? child.children.find((c) => c.type === "simple_identifier")?.text;
          const propType = child.children.find((c) => c.type === "type_annotation")?.children.find((c) => c.type === "type_identifier" || c.type === "user_type");
          const isLet = child.children.some((c) => c.text === "let");
          const isStatic = child.children.some((c) => c.text === "static" || c.text === "class");

          if (propName) {
            properties.push({
              kind: "property",
              name: propName,
              type: propType ? this.getNodeText(propType) : null,
              visibility: "public",
              isStatic,
              isReadonly: isLet,
              isOptional: false,
              defaultValue: null,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams: [],
      extends: extendsList[0] ?? null,
      implements: extendsList.slice(1),
      methods,
      properties,
      constructor: constructorMethod,
      location: this.getLocation(node),
      modifiers: isStruct ? [] : [],
      docComment,
      isAbstract: false,
    };
  }

  /**
   * Parses a Swift protocol declaration.
   */
  private parseSwiftProtocol(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name") ?? node.children.find((c) => c.type === "type_identifier");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Parse inheritance
    const inheritanceClause = node.children.find((c) => c.type === "inheritance_clause" || c.type === "type_inheritance_clause");
    const extendsList: string[] = [];
    if (inheritanceClause) {
      for (const child of inheritanceClause.children) {
        if (child.type === "type_identifier" || child.type === "user_type") {
          extendsList.push(child.text);
        }
      }
    }

    const methods: UCEInterfaceMethod[] = [];
    const properties: UCEInterfaceProperty[] = [];

    const bodyNode = node.children.find((c) => c.type === "protocol_body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "protocol_method_declaration" || child.type === "function_declaration") {
          const fn = this.parseSwiftFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: [],
              signature: fn.signature,
              isOptional: false,
              location: fn.location,
              docComment: fn.docComment,
            });
          }
        } else if (child.type === "protocol_property_declaration" || child.type === "property_declaration") {
          const propName = child.children.find((c) => c.type === "pattern")?.text ?? child.children.find((c) => c.type === "simple_identifier")?.text;
          const propType = child.children.find((c) => c.type === "type_annotation")?.children.find((c) => c.type === "type_identifier");

          if (propName) {
            properties.push({
              kind: "property",
              name: propName,
              type: propType ? this.getNodeText(propType) : null,
              isReadonly: false,
              isOptional: false,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "interface",
      name,
      typeParams: [],
      extends: extendsList,
      properties,
      methods,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
    };
  }

  // ===========================================================================
  // Dart Language Support
  // ===========================================================================

  /**
   * Parses a Dart function or method.
   */
  private parseDartFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name") ?? node.children.find((c) => c.type === "identifier");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters") ?? node.children.find((c) => c.type === "formal_parameter_list");
    const params = paramsNode ? this.parseDartParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("return_type") ?? node.children.find((c) => c.type === "type_identifier" || c.type === "type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode) : null;

    const bodyNode = node.childForFieldName("body") ?? node.children.find((c) => c.type === "function_body" || c.type === "block");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Extract modifiers
    const modifiers: UCEModifier[] = [];
    if (node.children.some((c: SyntaxNode) => c.text === "static")) modifiers.push("static");
    if (node.children.some((c: SyntaxNode) => c.text === "async")) modifiers.push("async");
    if (node.children.some((c: SyntaxNode) => c.text === "abstract")) modifiers.push("abstract");

    const docComment = this.extractDocComment(node);
    const signature = `${returnType ?? "void"} ${name}(${params.map(p => `${p.type || "dynamic"} ${p.name}`).join(", ")})`;

    return {
      kind: "function",
      name,
      params,
      returnType,
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature: signature.trim(),
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode ?? null) : 0,
    };
  }

  /**
   * Parses Dart function parameters.
   */
  private parseDartParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "formal_parameter" || child.type === "simple_formal_parameter" || child.type === "default_formal_parameter") {
        const nameNode = child.children.find((c) => c.type === "identifier");
        const typeNode = child.children.find((c) => c.type === "type_identifier" || c.type === "type");
        const defaultValueNode = child.children.find((c) => c.type === "expression" || c.previousSibling?.text === "=");
        const isRequired = child.children.some((c) => c.text === "required");

        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: !isRequired && (child.type === "default_formal_parameter" || defaultValueNode !== null),
          isRest: false,
          defaultValue: defaultValueNode ? this.getNodeText(defaultValueNode) : null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a Dart class definition.
   */
  private parseDartClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name") ?? node.children.find((c) => c.type === "identifier");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Parse superclass and interfaces
    const extendsClause = node.children.find((c) => c.type === "superclass");
    const implementsClause = node.children.find((c) => c.type === "interfaces");
    const withClause = node.children.find((c) => c.type === "mixins");

    let extendsClass: string | null = null;
    const implementsList: string[] = [];

    if (extendsClause) {
      const superType = extendsClause.children.find((c) => c.type === "type_identifier" || c.type === "identifier");
      extendsClass = superType?.text ?? null;
    }

    if (implementsClause) {
      for (const child of implementsClause.children) {
        if (child.type === "type_identifier" || child.type === "identifier") {
          implementsList.push(child.text);
        }
      }
    }

    if (withClause) {
      for (const child of withClause.children) {
        if (child.type === "type_identifier" || child.type === "identifier") {
          implementsList.push(child.text);
        }
      }
    }

    const bodyNode = node.children.find((c) => c.type === "class_body");
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "method_signature" || child.type === "function_signature") {
          const fn = this.parseDartFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: name.startsWith("_") ? "private" : "public",
              isStatic: fn.modifiers.includes("static"),
              isAbstract: fn.modifiers.includes("abstract"),
              isGetter: false,
              isSetter: false,
            });
          }
        } else if (child.type === "constructor_signature") {
          const fn = this.parseDartFunction(child);
          if (fn) {
            constructorMethod = {
              kind: "method",
              name: "constructor",
              params: fn.params,
              returnType: null,
              typeParams: [],
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: "public",
              isStatic: false,
              isAbstract: false,
              isGetter: false,
              isSetter: false,
            };
          }
        } else if (child.type === "declaration" || child.type === "initialized_variable_definition") {
          const propName = child.children.find((c) => c.type === "identifier");
          const propType = child.children.find((c) => c.type === "type_identifier" || c.type === "type");
          const isFinal = child.children.some((c) => c.text === "final");
          const isStatic = child.children.some((c) => c.text === "static");

          if (propName) {
            properties.push({
              kind: "property",
              name: propName.text,
              type: propType ? this.getNodeText(propType) : null,
              visibility: propName.text.startsWith("_") ? "private" : "public",
              isStatic,
              isReadonly: isFinal,
              isOptional: false,
              defaultValue: null,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    // Extract class modifiers
    const modifiers: UCEModifier[] = [];
    if (node.children.some((c: SyntaxNode) => c.text === "abstract")) modifiers.push("abstract");

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams: [],
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

  // ===========================================================================
  // Ruby Language Support
  // ===========================================================================

  /**
   * Parses a Ruby method node (method or singleton_method).
   */
  private parseRubyFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseRubyParameters(paramsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Ruby methods are dynamically typed - no explicit return types
    const modifiers: UCEModifier[] = [];
    if (node.type === "singleton_method") {
      modifiers.push("static");
    }

    const docComment = this.extractDocComment(node);
    const signature = this.buildFunctionSignature(name, params, null, [], modifiers);

    return {
      kind: "function",
      name,
      params,
      returnType: null,
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature,
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses Ruby method parameters.
   */
  private parseRubyParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "identifier" || child.type === "simple_parameter") {
        const name = child.text;
        params.push({
          name,
          type: null, // Ruby is dynamically typed
          isOptional: false,
          isRest: false,
          defaultValue: null,
        });
      } else if (child.type === "optional_parameter") {
        const nameNode = child.children.find((c) => c.type === "identifier");
        const valueNode = child.children.find((c) => c.type !== "identifier" && c.type !== "=");
        params.push({
          name: nameNode?.text ?? "",
          type: null,
          isOptional: true,
          isRest: false,
          defaultValue: valueNode ? this.getNodeText(valueNode) : null,
        });
      } else if (child.type === "splat_parameter") {
        const nameNode = child.children.find((c) => c.type === "identifier");
        params.push({
          name: nameNode?.text ?? "",
          type: null,
          isOptional: false,
          isRest: true,
          defaultValue: null,
        });
      } else if (child.type === "block_parameter") {
        const nameNode = child.children.find((c) => c.type === "identifier");
        params.push({
          name: nameNode?.text ?? "",
          type: null,
          isOptional: true,
          isRest: false,
          defaultValue: null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a Ruby class or module node.
   */
  private parseRubyClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Extract superclass
    let extendsClass: string | null = null;
    const superclassNode = node.childForFieldName("superclass");
    if (superclassNode) {
      extendsClass = superclassNode.text;
    }

    // Ruby modules can be mixed in - find include statements
    const implementsList: string[] = [];
    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "call" && child.children[0]?.text === "include") {
          const argNode = child.children.find((c) => c.type === "argument_list");
          if (argNode) {
            for (const arg of argNode.children) {
              if (arg.type === "constant" || arg.type === "scope_resolution") {
                implementsList.push(arg.text);
              }
            }
          }
        }
      }
    }

    // Extract methods
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "method" || child.type === "singleton_method") {
          const fn = this.parseRubyFunction(child);
          if (fn) {
            const method: UCEMethod = {
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: fn.name.startsWith("_") ? "private" : "public",
              isStatic: fn.modifiers.includes("static"),
              isAbstract: false,
              isGetter: false,
              isSetter: false,
            };
            if (fn.name === "initialize") {
              constructorMethod = method;
            } else {
              methods.push(method);
            }
          }
        } else if (child.type === "call") {
          // Handle attr_reader, attr_writer, attr_accessor
          const methodName = child.children[0]?.text;
          if (methodName === "attr_reader" || methodName === "attr_writer" || methodName === "attr_accessor") {
            const argList = child.children.find((c) => c.type === "argument_list");
            if (argList) {
              for (const arg of argList.children) {
                if (arg.type === "simple_symbol" || arg.type === "symbol") {
                  const propName = arg.text.replace(/^:/, "");
                  properties.push({
                    kind: "property",
                    name: propName,
                    type: null,
                    visibility: "public",
                    isStatic: false,
                    isReadonly: methodName === "attr_reader",
                    isOptional: false,
                    defaultValue: null,
                    location: this.getLocation(arg),
                    docComment: null,
                  });
                }
              }
            }
          }
        }
      }
    }

    const modifiers: UCEModifier[] = [];
    if (node.type === "module") {
      modifiers.push("abstract"); // Ruby modules can't be instantiated
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams: [],
      extends: extendsClass,
      implements: implementsList,
      methods,
      properties,
      constructor: constructorMethod,
      location: this.getLocation(node),
      modifiers,
      docComment,
      isAbstract: node.type === "module",
    };
  }

  // ===========================================================================
  // PHP Language Support
  // ===========================================================================

  /**
   * Parses a PHP function or method node.
   */
  private parsePhpFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parsePhpParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("return_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode).replace(/^:\s*/, "") : null;

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Extract modifiers
    const modifiers: UCEModifier[] = [];
    for (const child of node.children) {
      if (child.type === "visibility_modifier") {
        if (child.text === "private") modifiers.push("private");
        if (child.text === "protected") modifiers.push("protected");
      }
      if (child.type === "static_modifier" || child.text === "static") {
        modifiers.push("static");
      }
      if (child.text === "abstract") modifiers.push("abstract");
      if (child.text === "final") modifiers.push("final");
    }

    const docComment = this.extractDocComment(node);
    const signature = this.buildFunctionSignature(name, params, returnType, [], modifiers);

    return {
      kind: "function",
      name,
      params,
      returnType,
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature,
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses PHP function parameters.
   */
  private parsePhpParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "simple_parameter" || child.type === "property_promotion_parameter") {
        const nameNode = child.children.find((c) => c.type === "variable_name");
        const typeNode = child.children.find((c) =>
          c.type === "type_name" || c.type === "named_type" || c.type === "primitive_type" || c.type === "nullable_type"
        );
        const defaultNode = child.childForFieldName("default_value");
        const isVariadic = child.children.some((c) => c.type === "...");

        const name = nameNode?.text?.replace(/^\$/, "") ?? "";
        params.push({
          name,
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: defaultNode !== null,
          isRest: isVariadic,
          defaultValue: defaultNode ? this.getNodeText(defaultNode) : null,
        });
      } else if (child.type === "variadic_parameter") {
        const nameNode = child.children.find((c) => c.type === "variable_name");
        const typeNode = child.children.find((c) =>
          c.type === "type_name" || c.type === "named_type" || c.type === "primitive_type"
        );

        params.push({
          name: nameNode?.text?.replace(/^\$/, "") ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: false,
          isRest: true,
          defaultValue: null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a PHP class node.
   */
  private parsePhpClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Extract extends
    let extendsClass: string | null = null;
    const extendsClause = node.children.find((c: SyntaxNode) => c.type === "base_clause");
    if (extendsClause) {
      const extendName = extendsClause.children.find((c: SyntaxNode) => c.type === "name" || c.type === "qualified_name");
      extendsClass = extendName?.text ?? null;
    }

    // Extract implements
    const implementsList: string[] = [];
    const implementsClause = node.children.find((c: SyntaxNode) => c.type === "class_interface_clause");
    if (implementsClause) {
      for (const child of implementsClause.children) {
        if (child.type === "name" || child.type === "qualified_name") {
          implementsList.push(child.text);
        }
      }
    }

    // Extract methods and properties
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "method_declaration") {
          const fn = this.parsePhpFunction(child);
          if (fn) {
            const visibility = this.getPhpVisibility(child);
            const method: UCEMethod = {
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility,
              isStatic: fn.modifiers.includes("static"),
              isAbstract: fn.modifiers.includes("abstract"),
              isGetter: false,
              isSetter: false,
            };
            if (fn.name === "__construct") {
              constructorMethod = method;
            } else {
              methods.push(method);
            }
          }
        } else if (child.type === "property_declaration") {
          const visibility = this.getPhpVisibility(child);
          const isStatic = child.children.some((c: SyntaxNode) => c.text === "static");
          const isReadonly = child.children.some((c: SyntaxNode) => c.text === "readonly");
          const typeNode = child.children.find((c: SyntaxNode) =>
            c.type === "type_name" || c.type === "named_type" || c.type === "primitive_type" || c.type === "nullable_type"
          );

          for (const prop of child.children) {
            if (prop.type === "property_element") {
              const propNameNode = prop.children.find((c) => c.type === "variable_name");
              const defaultNode = prop.children.find((c) => c.type !== "variable_name" && c.type !== "=");

              if (propNameNode) {
                properties.push({
                  kind: "property",
                  name: propNameNode.text.replace(/^\$/, ""),
                  type: typeNode ? this.getNodeText(typeNode) : null,
                  visibility,
                  isStatic,
                  isReadonly,
                  isOptional: false,
                  defaultValue: defaultNode ? this.getNodeText(defaultNode) : null,
                  location: this.getLocation(prop),
                  docComment: null,
                });
              }
            }
          }
        }
      }
    }

    // Extract class modifiers
    const modifiers: UCEModifier[] = [];
    if (node.children.some((c: SyntaxNode) => c.text === "abstract")) modifiers.push("abstract");
    if (node.children.some((c: SyntaxNode) => c.text === "final")) modifiers.push("final");

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams: [],
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
   * Gets PHP visibility from a node.
   */
  private getPhpVisibility(node: SyntaxNode): UCEVisibility {
    for (const child of node.children) {
      if (child.type === "visibility_modifier" || child.type === "modifier") {
        if (child.text === "private") return "private";
        if (child.text === "protected") return "protected";
      }
    }
    return "public";
  }

  /**
   * Parses a PHP interface node.
   */
  private parsePhpInterface(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Extract extends
    const extendsList: string[] = [];
    const extendsClause = node.children.find((c: SyntaxNode) => c.type === "base_clause");
    if (extendsClause) {
      for (const child of extendsClause.children) {
        if (child.type === "name" || child.type === "qualified_name") {
          extendsList.push(child.text);
        }
      }
    }

    // Extract methods
    const methods: UCEInterfaceMethod[] = [];
    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "method_declaration") {
          const fn = this.parsePhpFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: [],
              signature: fn.signature,
              isOptional: false,
              location: fn.location,
              docComment: fn.docComment,
            });
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "interface",
      name,
      typeParams: [],
      extends: extendsList,
      properties: [],
      methods,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
    };
  }

  // ===========================================================================
  // Bash Language Support
  // ===========================================================================

  /**
   * Parses a Bash function definition.
   */
  private parseBashFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Bash functions don't have explicit parameters - they use $1, $2, etc.
    const params: UCEParameter[] = [];

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    const docComment = this.extractDocComment(node);
    const signature = `${name}()`;

    return {
      kind: "function",
      name,
      params,
      returnType: null, // Bash functions return exit codes, not typed values
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
      signature,
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  // ===========================================================================
  // Scala Language Support
  // ===========================================================================

  /**
   * Parses a Scala function definition.
   */
  private parseScalaFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseScalaParameters(paramsNode) : [];

    const returnTypeNode = node.childForFieldName("return_type");
    const returnType = returnTypeNode ? this.getNodeText(returnTypeNode) : null;

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    const modifiers: UCEModifier[] = [];
    for (const child of node.children) {
      if (child.type === "modifiers") {
        if (child.text.includes("private")) modifiers.push("private");
        if (child.text.includes("protected")) modifiers.push("protected");
        if (child.text.includes("final")) modifiers.push("final");
        if (child.text.includes("abstract")) modifiers.push("abstract");
      }
    }

    const docComment = this.extractDocComment(node);
    const signature = this.buildFunctionSignature(name, params, returnType, [], modifiers);

    return {
      kind: "function",
      name,
      params,
      returnType,
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature,
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses Scala function parameters.
   */
  private parseScalaParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "parameter") {
        const nameNode = child.childForFieldName("name");
        const typeNode = child.childForFieldName("type");
        const defaultNode = child.childForFieldName("default");

        params.push({
          name: nameNode?.text ?? "",
          type: typeNode ? this.getNodeText(typeNode) : null,
          isOptional: defaultNode !== null,
          isRest: false,
          defaultValue: defaultNode ? this.getNodeText(defaultNode) : null,
        });
      }
    }

    return params;
  }

  /**
   * Parses a Scala class, object, or trait definition.
   */
  private parseScalaClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Extract extends
    let extendsClass: string | null = null;
    const extendsClause = node.children.find((c: SyntaxNode) => c.type === "extends_clause");
    if (extendsClause) {
      const typeNode = extendsClause.children.find((c: SyntaxNode) => c.type === "type_identifier");
      extendsClass = typeNode?.text ?? null;
    }

    // Extract with (mixins)
    const implementsList: string[] = [];
    for (const child of node.children) {
      if (child.type === "extends_clause") {
        for (const mixinChild of child.children) {
          if (mixinChild.type === "type_identifier" && mixinChild.text !== extendsClass) {
            implementsList.push(mixinChild.text);
          }
        }
      }
    }

    // Extract methods and properties
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];
    let constructorMethod: UCEMethod | null = null;

    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "function_definition") {
          const fn = this.parseScalaFunction(child);
          if (fn) {
            const method: UCEMethod = {
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: fn.modifiers.includes("private") ? "private" : fn.modifiers.includes("protected") ? "protected" : "public",
              isStatic: false,
              isAbstract: fn.modifiers.includes("abstract"),
              isGetter: false,
              isSetter: false,
            };
            methods.push(method);
          }
        } else if (child.type === "val_definition" || child.type === "var_definition") {
          const propName = child.childForFieldName("pattern");
          const propType = child.childForFieldName("type");
          const isVal = child.type === "val_definition";

          if (propName) {
            properties.push({
              kind: "property",
              name: propName.text,
              type: propType ? this.getNodeText(propType) : null,
              visibility: "public",
              isStatic: false,
              isReadonly: isVal,
              isOptional: false,
              defaultValue: null,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    const modifiers: UCEModifier[] = [];
    if (node.type === "object_definition") modifiers.push("static");
    if (node.type === "trait_definition") modifiers.push("abstract");

    // Check for abstract modifier in class_definition
    const modifiersNode = node.children.find((c: SyntaxNode) => c.type === "modifiers");
    const hasAbstract = modifiersNode?.text.includes("abstract") ?? false;
    if (hasAbstract) modifiers.push("abstract");

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams: [],
      extends: extendsClass,
      implements: implementsList,
      methods,
      properties,
      constructor: constructorMethod,
      location: this.getLocation(node),
      modifiers,
      docComment,
      isAbstract: node.type === "trait_definition" || hasAbstract,
    };
  }

  /**
   * Parses a Scala trait as an interface.
   */
  private parseScalaTrait(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const methods: UCEInterfaceMethod[] = [];
    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "function_definition") {
          const fn = this.parseScalaFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: [],
              signature: fn.signature,
              isOptional: false,
              location: fn.location,
              docComment: fn.docComment,
            });
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "interface",
      name,
      typeParams: [],
      extends: [],
      properties: [],
      methods,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
    };
  }

  // ===========================================================================
  // Haskell Language Support
  // ===========================================================================

  /**
   * Parses a Haskell function definition.
   */
  private parseHaskellFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Haskell functions use pattern matching, parameters are patterns
    const params: UCEParameter[] = [];
    for (const child of node.children) {
      if (child.type === "patterns" || child.type === "pat") {
        for (const pattern of child.children) {
          if (pattern.type === "variable" || pattern.type === "pat_name") {
            params.push({
              name: pattern.text,
              type: null, // Haskell uses type inference
              isOptional: false,
              isRest: false,
              defaultValue: null,
            });
          }
        }
      }
    }

    const bodyNode = node.childForFieldName("rhs") || node.childForFieldName("match");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    const docComment = this.extractDocComment(node);
    const signature = `${name} :: ...`; // Haskell type signatures are separate

    return {
      kind: "function",
      name,
      params,
      returnType: null,
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
      signature,
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses a Haskell data type (ADT) as a class.
   */
  private parseHaskellClass(node: SyntaxNode): UCEClass | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    // Haskell ADTs have constructors
    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];

    // Extract constructors as static factory methods
    for (const child of node.children) {
      if (child.type === "constructor" || child.type === "data_constructor") {
        const constrName = child.childForFieldName("name");
        if (constrName) {
          methods.push({
            kind: "method",
            name: constrName.text,
            params: [],
            returnType: name,
            typeParams: [],
            body: "",
            location: this.getLocation(child),
            modifiers: [],
            docComment: null,
            signature: constrName.text,
            visibility: "public",
            isStatic: true,
            isAbstract: false,
            isGetter: false,
            isSetter: false,
          });
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams: [],
      extends: null,
      implements: [],
      methods,
      properties,
      constructor: null,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
      isAbstract: false,
    };
  }

  /**
   * Parses a Haskell type class as an interface.
   */
  private parseHaskellTypeClass(node: SyntaxNode): UCEInterface | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const methods: UCEInterfaceMethod[] = [];
    const bodyNode = node.childForFieldName("where") || node.childForFieldName("declarations");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "signature" || child.type === "type_signature") {
          const sigName = child.childForFieldName("name");
          if (sigName) {
            methods.push({
              kind: "method",
              name: sigName.text,
              params: [],
              returnType: null,
              typeParams: [],
              signature: this.getNodeText(child),
              isOptional: false,
              location: this.getLocation(child),
              docComment: null,
            });
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "interface",
      name,
      typeParams: [],
      extends: [],
      properties: [],
      methods,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
    };
  }

  // ===========================================================================
  // Elixir Language Support
  // ===========================================================================

  /**
   * Parses an Elixir function definition (def/defp).
   */
  private parseElixirFunction(node: SyntaxNode): UCEFunction | null {
    // Elixir uses def/defp macro calls
    if (node.type !== "call") return null;

    const target = node.children[0];
    if (!target || (target.text !== "def" && target.text !== "defp")) {
      return null;
    }

    const isPrivate = target.text === "defp";

    // Get function name and params from arguments
    const args = node.children.find((c: SyntaxNode) => c.type === "arguments");
    if (!args) return null;

    let name = "";
    const params: UCEParameter[] = [];

    const firstArg = args.children[0];
    if (firstArg?.type === "call") {
      // def func_name(args)
      const funcName = firstArg.children[0];
      name = funcName?.text ?? "";

      const funcArgs = firstArg.children.find((c: SyntaxNode) => c.type === "arguments");
      if (funcArgs) {
        for (const arg of funcArgs.children) {
          if (arg.type === "identifier") {
            params.push({
              name: arg.text,
              type: null,
              isOptional: false,
              isRest: false,
              defaultValue: null,
            });
          }
        }
      }
    } else if (firstArg?.type === "identifier") {
      name = firstArg.text;
    }

    if (!name) return null;

    const bodyNode = node.children.find((c: SyntaxNode) => c.type === "do_block");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    const modifiers: UCEModifier[] = [];
    if (isPrivate) modifiers.push("private");

    const docComment = this.extractDocComment(node);
    const signature = `${target.text} ${name}(${params.map(p => p.name).join(", ")})`;

    return {
      kind: "function",
      name,
      params,
      returnType: null,
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature,
      complexity: this.options.calculateComplexity && bodyNode ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses an Elixir module definition as a class.
   */
  private parseElixirModule(node: SyntaxNode): UCEClass | null {
    if (node.type !== "call") return null;

    const target = node.children[0];
    if (!target || target.text !== "defmodule") {
      return null;
    }

    const args = node.children.find((c: SyntaxNode) => c.type === "arguments");
    if (!args) return null;

    const nameNode = args.children[0];
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const methods: UCEMethod[] = [];
    const properties: UCEProperty[] = [];

    const bodyNode = node.children.find((c: SyntaxNode) => c.type === "do_block");
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === "call") {
          const fn = this.parseElixirFunction(child);
          if (fn) {
            methods.push({
              kind: "method",
              name: fn.name,
              params: fn.params,
              returnType: fn.returnType,
              typeParams: fn.typeParams,
              body: fn.body,
              location: fn.location,
              modifiers: fn.modifiers,
              docComment: fn.docComment,
              signature: fn.signature,
              visibility: fn.modifiers.includes("private") ? "private" : "public",
              isStatic: true, // Elixir module functions are essentially static
              isAbstract: false,
              isGetter: false,
              isSetter: false,
            });
          }
        }
      }
    }

    const docComment = this.extractDocComment(node);

    return {
      kind: "class",
      name,
      typeParams: [],
      extends: null,
      implements: [],
      methods,
      properties,
      constructor: null,
      location: this.getLocation(node),
      modifiers: [],
      docComment,
      isAbstract: false,
    };
  }

  // ===========================================================================
  // Lua Language Support
  // ===========================================================================

  /**
   * Parses a Lua function definition.
   */
  private parseLuaFunction(node: SyntaxNode): UCEFunction | null {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";

    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode ? this.parseLuaParameters(paramsNode) : [];

    const bodyNode = node.childForFieldName("body");
    const body = bodyNode && this.options.includeBodies
      ? this.truncateBody(this.getNodeText(bodyNode))
      : "";

    // Check if local
    const modifiers: UCEModifier[] = [];
    const isLocal = node.parent?.type === "local_function" ||
                    node.children.some((c: SyntaxNode) => c.text === "local");
    if (isLocal) modifiers.push("private");

    const docComment = this.extractDocComment(node);
    const signature = `function ${name}(${params.map(p => p.name).join(", ")})`;

    return {
      kind: "function",
      name,
      params,
      returnType: null, // Lua is dynamically typed
      typeParams: [],
      body,
      location: this.getLocation(node),
      modifiers,
      docComment,
      signature,
      complexity: this.options.calculateComplexity ? this.calculateComplexity(bodyNode) : 0,
    };
  }

  /**
   * Parses Lua function parameters.
   */
  private parseLuaParameters(paramsNode: SyntaxNode): UCEParameter[] {
    const params: UCEParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === "identifier" || child.type === "name") {
        params.push({
          name: child.text,
          type: null,
          isOptional: false,
          isRest: false,
          defaultValue: null,
        });
      } else if (child.type === "vararg_expression" || child.text === "...") {
        params.push({
          name: "...",
          type: null,
          isOptional: true,
          isRest: true,
          defaultValue: null,
        });
      }
    }

    return params;
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
