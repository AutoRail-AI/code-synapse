
import { describe, it, expect } from "vitest";
import { checkTrivialEntity, EntityInfo } from "./trivial-filter.js";

describe("Trivial Entity Filter", () => {
    describe("Functions", () => {
        it("should identify simple 1-line getter as trivial", () => {
            const entity: EntityInfo = {
                id: "1",
                name: "getUserId",
                type: "function",
                filePath: "src/user.ts",
                lineCount: 1,
                signature: "getUserId(): string",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("simple_getter");
            expect(result.defaultJustification?.purposeSummary).toContain("returns the userId property");
        });

        it("should identify multi-line getter (3 lines) as trivial", () => {
            const entity: EntityInfo = {
                id: "2",
                name: "getName",
                type: "function",
                filePath: "src/user.ts",
                lineCount: 3,
                signature: "getName(): string",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("simple_getter");
        });

        it("should identifying >3 line getter as NON-trivial (Strict Mode)", () => {
            const entity: EntityInfo = {
                id: "3",
                name: "getComplexConfig",
                type: "function",
                filePath: "src/config.ts",
                lineCount: 4,
                signature: "getComplexConfig(): Config",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(false);
        });

        it("should identify sensitive named function (validate) as NON-trivial even if 1 line", () => {
            const entity: EntityInfo = {
                id: "4",
                name: "validateInput",
                type: "function",
                filePath: "src/validation.ts",
                lineCount: 1,
                signature: "validateInput(input: string): boolean",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(false);
        });

        it("should identify sensitive named function (auth) as NON-trivial even if 1 line", () => {
            const entity: EntityInfo = {
                id: "5",
                name: "checkAuth",
                type: "function",
                filePath: "src/auth.ts",
                lineCount: 1,
                signature: "checkAuth(): boolean",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(false);
        });

        it("should identify generic function > 1 line as NON-trivial", () => {
            const entity: EntityInfo = {
                id: "6",
                name: "calculateTotal",
                type: "function",
                filePath: "src/calc.ts",
                lineCount: 2,
                signature: "calculateTotal(): number",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(false);
        });

        it("should identify generic function = 1 line as trivial", () => {
            const entity: EntityInfo = {
                id: "7",
                name: "simpleHelper",
                type: "function",
                filePath: "src/calc.ts",
                lineCount: 1, // Only 1-liners are trivial for generic functions now
                signature: "simpleHelper(): void",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("very_short_function");
        });

        it("should identify noop/identity as trivial", () => {
            const entity: EntityInfo = {
                id: "8",
                name: "noop",
                type: "function",
                filePath: "src/utils.ts",
                lineCount: 10, // Even if longer, noop is noop
                signature: "noop(): void",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("trivial_utility");
        });
    });

    describe("Classes", () => {
        it("should identify small class (<=3 lines) as trivial", () => {
            const entity: EntityInfo = {
                id: "c1",
                name: "EmptyClass",
                type: "class",
                filePath: "src/types.ts",
                lineCount: 3,
                signature: "class EmptyClass",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("minimal_class");
        });

        it("should identify >3 line class as NON-trivial", () => {
            const entity: EntityInfo = {
                id: "c2",
                name: "SmallService",
                type: "class",
                filePath: "src/service.ts",
                lineCount: 4,
                signature: "class SmallService",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(false);
        });

        it("should identify Exception classes as trivial", () => {
            const entity: EntityInfo = {
                id: "c3",
                name: "CustomError",
                type: "class",
                filePath: "src/error.ts",
                lineCount: 20,
                signature: "class CustomError",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("error_class");
        });
    });

    describe("Interfaces", () => {
        it("should identify Props interface as trivial regardless of size", () => {
            const entity: EntityInfo = {
                id: "i1",
                name: "ButtonProps",
                type: "interface",
                filePath: "src/components.ts",
                lineCount: 50,
                signature: "interface ButtonProps",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("config_interface");
        });

        it("should identify small interface (<=3 lines) as trivial", () => {
            const entity: EntityInfo = {
                id: "i2",
                name: "SimpleState",
                type: "interface",
                filePath: "src/state.ts",
                lineCount: 3,
                signature: "interface SimpleState",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("minimal_interface");
        });

        it("should identify >3 line interface as NON-trivial", () => {
            const entity: EntityInfo = {
                id: "i3",
                name: "ComplexContract",
                type: "interface",
                filePath: "src/contract.ts",
                lineCount: 4,
                signature: "interface ComplexContract",
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(false);
        });
    });

    describe("Files", () => {
        it("should identify test files as trivial", () => {
            const entity: EntityInfo = {
                id: "f1",
                name: "user.test.ts",
                type: "file",
                filePath: "src/user.test.ts",
                lineCount: 1,
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("test_file");
        });

        it("should identify spec files as trivial", () => {
            const entity: EntityInfo = {
                id: "f2",
                name: "user.spec.ts",
                type: "file",
                filePath: "src/user.spec.ts",
                lineCount: 1,
            };
            const result = checkTrivialEntity(entity);
            expect(result.isTrivial).toBe(true);
            expect(result.reason).toBe("test_file");
        });
    });

    describe("Default Justifications", () => {
        it("should include signature in default justification for functions", () => {
            const entity: EntityInfo = {
                id: "d1",
                name: "noop",
                type: "function",
                filePath: "src/utils.ts",
                lineCount: 1,
                signature: "noop(): void",
            };
            const result = checkTrivialEntity(entity);
            expect(result.defaultJustification?.purposeSummary).toContain("noop(): void");
        });
    });
});
