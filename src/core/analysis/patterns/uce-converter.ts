/**
 * UCE to Pattern Context Converter
 *
 * Converts Universal Code Entity (UCE) types to Pattern Analysis types.
 * This bridges the extraction layer with the pattern detection layer.
 *
 * @module
 */

import type {
  UCEClass,
  UCEFunction,
  UCEInterface,
  UCEMethod,
  UCEProperty,
  UCEInterfaceMethod,
  UCEInterfaceProperty,
} from "../../../types/uce.js";
import type {
  ClassInfo,
  FunctionInfo,
  InterfaceInfo,
  MethodInfo,
  PropertyInfo,
  ParameterInfo,
  PatternAnalysisContext,
} from "./interfaces.js";
import { generateEntityId } from "../../extraction/id-generator.js";

/**
 * Convert UCE parameter to pattern parameter info.
 */
function convertParameter(param: { name: string; type: string | null; isOptional: boolean }): ParameterInfo {
  return {
    name: param.name,
    type: param.type ?? undefined,
    isOptional: param.isOptional,
  };
}

/**
 * Convert UCE method to pattern method info.
 */
function convertMethod(method: UCEMethod, classId: string): MethodInfo {
  const methodId = generateEntityId(classId, "method", method.name, method.signature, "");

  return {
    id: methodId,
    name: method.name,
    classId,
    parameters: method.params.map(convertParameter),
    returnType: method.returnType ?? undefined,
    isStatic: method.isStatic,
    isAsync: method.modifiers.includes("async"),
    isPrivate: method.visibility === "private",
    isPublic: method.visibility === "public",
    body: method.body || undefined,
  };
}

/**
 * Convert UCE property to pattern property info.
 */
function convertProperty(prop: UCEProperty): PropertyInfo {
  return {
    name: prop.name,
    type: prop.type ?? undefined,
    isStatic: prop.isStatic,
    isPrivate: prop.visibility === "private",
    defaultValue: prop.defaultValue ?? undefined,
  };
}

/**
 * Check if a class has a private/protected constructor.
 */
function hasPrivateConstructor(cls: UCEClass): boolean {
  if (!cls.constructor) return false;
  return cls.constructor.visibility === "private" || cls.constructor.visibility === "protected";
}

/**
 * Convert UCE class to pattern class info.
 */
function convertClass(cls: UCEClass, fileId: string): ClassInfo {
  const classId = generateEntityId(fileId, "class", cls.name, "", "");

  return {
    id: classId,
    name: cls.name,
    filePath: cls.location.filePath,
    methods: cls.methods.map((m) => convertMethod(m, classId)),
    properties: cls.properties.map(convertProperty),
    constructorParams: cls.constructor?.params.map(convertParameter) ?? [],
    extendsClass: cls.extends ?? undefined,
    implementsInterfaces: cls.implements,
    isAbstract: cls.isAbstract,
    isExported: cls.modifiers.includes("export"),
    hasPrivateConstructor: hasPrivateConstructor(cls),
  };
}

/**
 * Convert UCE function to pattern function info.
 */
function convertFunction(fn: UCEFunction, fileId: string): FunctionInfo {
  const functionId = generateEntityId(fileId, "function", fn.name, fn.signature, "");

  return {
    id: functionId,
    name: fn.name,
    filePath: fn.location.filePath,
    parameters: fn.params.map(convertParameter),
    returnType: fn.returnType ?? undefined,
    isExported: fn.modifiers.includes("export"),
    isAsync: fn.modifiers.includes("async"),
    body: fn.body || undefined,
  };
}

/**
 * Convert UCE interface method to pattern interface method info.
 */
function convertInterfaceMethod(method: UCEInterfaceMethod): {
  name: string;
  parameters: ParameterInfo[];
  returnType?: string;
} {
  return {
    name: method.name,
    parameters: method.params.map(convertParameter),
    returnType: method.returnType ?? undefined,
  };
}

/**
 * Convert UCE interface property to pattern interface property info.
 */
function convertInterfaceProperty(prop: UCEInterfaceProperty): {
  name: string;
  type?: string;
  isOptional: boolean;
} {
  return {
    name: prop.name,
    type: prop.type ?? undefined,
    isOptional: prop.isOptional,
  };
}

/**
 * Convert UCE interface to pattern interface info.
 */
function convertInterface(iface: UCEInterface, fileId: string): InterfaceInfo {
  const interfaceId = generateEntityId(fileId, "interface", iface.name, "", "");

  return {
    id: interfaceId,
    name: iface.name,
    filePath: iface.location.filePath,
    methods: iface.methods.map(convertInterfaceMethod),
    properties: iface.properties.map(convertInterfaceProperty),
    extendsInterfaces: iface.extends,
    isExported: iface.modifiers.includes("export"),
  };
}

/**
 * Convert UCE file entities to a PatternAnalysisContext.
 *
 * @param classes - UCE classes from the parsed file
 * @param functions - UCE functions from the parsed file
 * @param interfaces - UCE interfaces from the parsed file
 * @param fileId - The generated file ID
 * @param filePath - The file path
 * @returns PatternAnalysisContext ready for pattern detection
 */
export function convertUCEToPatternContext(
  classes: UCEClass[],
  functions: UCEFunction[],
  interfaces: UCEInterface[],
  fileId: string,
  filePath: string
): PatternAnalysisContext {
  return {
    classes: classes.map((c) => convertClass(c, fileId)),
    functions: functions.map((f) => convertFunction(f, fileId)),
    interfaces: interfaces.map((i) => convertInterface(i, fileId)),
    filePath,
  };
}

/**
 * Re-export types for convenience.
 */
export type { ClassInfo, FunctionInfo, InterfaceInfo, PatternAnalysisContext };
