/**
 * Type Resolver
 *
 * Resolves types for symbols using TypeScript Compiler API.
 * Provides detailed type information for functions, classes, and variables.
 *
 * @module
 */

import * as ts from "typescript";
import type {
  TypeInfo,
  ResolvedParameter,
  ResolvedFunctionSignature,
} from "./types.js";

// =============================================================================
// Type Resolver Class
// =============================================================================

/**
 * Resolves types from TypeScript nodes using the Compiler API.
 *
 * @example
 * ```typescript
 * const resolver = new TypeResolver(typeChecker);
 *
 * // Resolve a node's type
 * const typeInfo = resolver.resolveType(node);
 *
 * // Get a function's complete signature
 * const signature = resolver.resolveFunctionSignature(functionNode);
 * ```
 */
export class TypeResolver {
  constructor(
    private typeChecker: ts.TypeChecker,
    private program: ts.Program
  ) {}

  /**
   * Resolves the type of a TypeScript node.
   *
   * @param node - The node to get type for
   * @returns Detailed type information
   */
  resolveType(node: ts.Node): TypeInfo {
    const type = this.typeChecker.getTypeAtLocation(node);
    return this.analyzeType(type);
  }

  /**
   * Resolves a complete function signature with all parameter and return types.
   *
   * @param node - Function declaration, expression, or method
   * @returns Complete resolved signature
   */
  resolveFunctionSignature(
    node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration
  ): ResolvedFunctionSignature {
    const signature = this.typeChecker.getSignatureFromDeclaration(node);

    // Get function name
    let name = "<anonymous>";
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      name = node.name?.getText() ?? "<anonymous>";
    }

    // Resolve parameters
    const parameters = this.resolveParameters(node.parameters);

    // Resolve return type
    let returnType: TypeInfo;
    if (signature) {
      const returnTsType = signature.getReturnType();
      returnType = this.analyzeType(returnTsType);
    } else {
      returnType = this.createUnknownType();
    }

    // Get type parameters
    const typeParameters = this.resolveTypeParameters(node);

    // Build signature string
    const signatureString = this.buildSignatureString(
      name,
      parameters,
      returnType,
      typeParameters
    );

    // Check for async/generator
    const isAsync = this.hasModifier(node, ts.SyntaxKind.AsyncKeyword);
    const isGenerator = !!(node as ts.FunctionDeclaration).asteriskToken;

    return {
      name,
      parameters,
      returnType,
      typeParameters,
      signatureString,
      isAsync,
      isGenerator,
    };
  }

  /**
   * Resolves parameter types from a parameter list.
   *
   * @param parameters - Parameter declarations
   * @returns Array of resolved parameters
   */
  resolveParameters(
    parameters: ts.NodeArray<ts.ParameterDeclaration>
  ): ResolvedParameter[] {
    return parameters.map((param) => this.resolveParameter(param));
  }

  /**
   * Resolves a single parameter's type information.
   *
   * @param param - Parameter declaration
   * @returns Resolved parameter info
   */
  resolveParameter(param: ts.ParameterDeclaration): ResolvedParameter {
    const name = param.name.getText();
    const type = this.typeChecker.getTypeAtLocation(param);
    const typeInfo = this.analyzeType(type);

    const isOptional = !!param.questionToken || !!param.initializer;
    const isRest = !!param.dotDotDotToken;

    let defaultValue: string | undefined;
    if (param.initializer) {
      defaultValue = param.initializer.getText();
    }

    return {
      name,
      type: typeInfo,
      isOptional,
      isRest,
      defaultValue,
    };
  }

  /**
   * Resolves type parameters from a generic declaration.
   *
   * @param node - Node with potential type parameters
   * @returns Array of type parameter names
   */
  resolveTypeParameters(
    node: ts.Node & { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }
  ): string[] {
    if (!node.typeParameters) {
      return [];
    }

    return node.typeParameters.map((tp) => {
      let result = tp.name.getText();
      if (tp.constraint) {
        result += ` extends ${tp.constraint.getText()}`;
      }
      if (tp.default) {
        result += ` = ${tp.default.getText()}`;
      }
      return result;
    });
  }

  /**
   * Gets the type string for a node.
   *
   * @param node - Node to get type string for
   * @returns Type as string
   */
  getTypeString(node: ts.Node): string {
    const type = this.typeChecker.getTypeAtLocation(node);
    return this.typeChecker.typeToString(type);
  }

  /**
   * Resolves the return type of a function.
   *
   * @param node - Function node
   * @returns Return type info
   */
  resolveReturnType(
    node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration
  ): TypeInfo {
    const signature = this.typeChecker.getSignatureFromDeclaration(node);
    if (signature) {
      const returnType = signature.getReturnType();
      return this.analyzeType(returnType);
    }
    return this.createUnknownType();
  }

  /**
   * Resolves the type of a class.
   *
   * @param node - Class declaration
   * @returns Class type info
   */
  resolveClassType(node: ts.ClassDeclaration): TypeInfo {
    const type = this.typeChecker.getTypeAtLocation(node);
    return this.analyzeType(type);
  }

  /**
   * Resolves the type of a variable.
   *
   * @param node - Variable declaration
   * @returns Variable type info
   */
  resolveVariableType(node: ts.VariableDeclaration): TypeInfo {
    const type = this.typeChecker.getTypeAtLocation(node);
    return this.analyzeType(type);
  }

  /**
   * Resolves a type alias definition.
   *
   * @param node - Type alias declaration
   * @returns Type info for the alias
   */
  resolveTypeAlias(node: ts.TypeAliasDeclaration): TypeInfo {
    const type = this.typeChecker.getTypeAtLocation(node);
    return this.analyzeType(type);
  }

  /**
   * Gets the symbol for a node.
   *
   * @param node - Node to get symbol for
   * @returns Symbol or undefined
   */
  getSymbol(node: ts.Node): ts.Symbol | undefined {
    return this.typeChecker.getSymbolAtLocation(node);
  }

  /**
   * Gets the type at a specific position in a source file.
   *
   * @param sourceFile - Source file
   * @param position - Position in the file
   * @returns Type info at position
   */
  getTypeAtPosition(sourceFile: ts.SourceFile, position: number): TypeInfo | null {
    const node = this.findNodeAtPosition(sourceFile, position);
    if (!node) {
      return null;
    }
    return this.resolveType(node);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Analyzes a TypeScript type and extracts detailed information.
   */
  private analyzeType(type: ts.Type): TypeInfo {
    const typeString = this.typeChecker.typeToString(type);

    // Check type flags
    const flags = type.getFlags();
    const isPrimitive = this.isPrimitiveType(flags);
    const isUnion = !!(flags & ts.TypeFlags.Union);
    const isIntersection = !!(flags & ts.TypeFlags.Intersection);

    // Check for array
    const isArray = this.isArrayType(type);

    // Check for function
    const isFunction = type.getCallSignatures().length > 0;

    // Check for generic
    const typeArguments = this.getTypeArguments(type);
    const isGeneric = typeArguments.length > 0;

    // Check if custom type (not primitive, not built-in)
    const isCustomType = !isPrimitive && !this.isBuiltInType(typeString);

    return {
      typeString,
      isUnion,
      isIntersection,
      isPrimitive,
      isCustomType,
      isArray,
      isFunction,
      isGeneric,
      typeArguments: isGeneric ? typeArguments : undefined,
    };
  }

  /**
   * Checks if type flags indicate a primitive type.
   */
  private isPrimitiveType(flags: ts.TypeFlags): boolean {
    return !!(
      flags & ts.TypeFlags.String ||
      flags & ts.TypeFlags.Number ||
      flags & ts.TypeFlags.Boolean ||
      flags & ts.TypeFlags.BigInt ||
      flags & ts.TypeFlags.Null ||
      flags & ts.TypeFlags.Undefined ||
      flags & ts.TypeFlags.Void ||
      flags & ts.TypeFlags.Never
    );
  }

  /**
   * Checks if a type is an array type.
   */
  private isArrayType(type: ts.Type): boolean {
    const typeString = this.typeChecker.typeToString(type);
    return (
      typeString.endsWith("[]") ||
      typeString.startsWith("Array<") ||
      typeString.startsWith("ReadonlyArray<")
    );
  }

  /**
   * Checks if a type string represents a built-in type.
   */
  private isBuiltInType(typeString: string): boolean {
    const builtIns = [
      "string",
      "number",
      "boolean",
      "object",
      "symbol",
      "bigint",
      "null",
      "undefined",
      "void",
      "never",
      "any",
      "unknown",
      "Array",
      "Map",
      "Set",
      "Promise",
      "Date",
      "RegExp",
      "Error",
      "Function",
      "Object",
    ];

    // Check base type (before generic brackets)
    const baseType = typeString.split("<")[0]?.trim() ?? typeString;
    return builtIns.includes(baseType);
  }

  /**
   * Gets type arguments for generic types.
   */
  private getTypeArguments(type: ts.Type): string[] {
    // Check if it's a type reference with type arguments
    if ((type as ts.TypeReference).typeArguments) {
      return (type as ts.TypeReference).typeArguments!.map((arg) =>
        this.typeChecker.typeToString(arg)
      );
    }
    return [];
  }

  /**
   * Creates an unknown type info object.
   */
  private createUnknownType(): TypeInfo {
    return {
      typeString: "unknown",
      isUnion: false,
      isIntersection: false,
      isPrimitive: false,
      isCustomType: false,
      isArray: false,
      isFunction: false,
      isGeneric: false,
    };
  }

  /**
   * Builds a signature string from resolved parts.
   */
  private buildSignatureString(
    name: string,
    parameters: ResolvedParameter[],
    returnType: TypeInfo,
    typeParameters: string[]
  ): string {
    const typeParamsStr = typeParameters.length > 0
      ? `<${typeParameters.join(", ")}>`
      : "";

    const paramsStr = parameters
      .map((p) => {
        let param = p.isRest ? `...${p.name}` : p.name;
        if (p.isOptional && !p.defaultValue) {
          param += "?";
        }
        param += `: ${p.type.typeString}`;
        if (p.defaultValue) {
          param += ` = ${p.defaultValue}`;
        }
        return param;
      })
      .join(", ");

    return `${name}${typeParamsStr}(${paramsStr}): ${returnType.typeString}`;
  }

  /**
   * Checks if a node has a specific modifier.
   */
  private hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return modifiers?.some((m) => m.kind === kind) ?? false;
  }

  /**
   * Finds the most specific node at a given position.
   */
  private findNodeAtPosition(
    sourceFile: ts.SourceFile,
    position: number
  ): ts.Node | null {
    let result: ts.Node | null = null;

    const visit = (node: ts.Node): void => {
      if (position >= node.getStart() && position <= node.getEnd()) {
        result = node;
        ts.forEachChild(node, visit);
      }
    };

    visit(sourceFile);
    return result;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a TypeResolver instance.
 *
 * @param typeChecker - TypeScript TypeChecker
 * @param program - TypeScript Program
 */
export function createTypeResolver(
  typeChecker: ts.TypeChecker,
  program: ts.Program
): TypeResolver {
  return new TypeResolver(typeChecker, program);
}
