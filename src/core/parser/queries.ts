/**
 * Tree-sitter queries for import extraction.
 *
 * @module
 */

export const IMPORT_QUERIES: Record<string, string> = {
    // Java imports
    // Example: import com.example.UserService;
    java: `
    (import_declaration
      (scoped_identifier) @import_name) @import
  `,

    // Rust imports
    // Example: use std::collections::HashMap;
    rust: `
    (use_declaration
      argument: [(scoped_identifier) (identifier)] @import_name) @import
  `,

    // Go imports
    // Example: import "fmt" or import ( "fmt" "os" )
    go: `
    (import_spec
      path: (interpreted_string_literal) @import_source) @import
  `,

    // Python imports
    // Example: import os / from os import path
    python: `
    (import_statement
      name: [(dotted_name) (aliased_import)] @import_name) @import
    (import_from_statement
      module_name: (dotted_name) @import_source
      name: [(dotted_name) (aliased_import) (wildcard_import)] @import_name) @import
  `,

    // C# imports
    // Example: using System;
    csharp: `
    (using_directive
      name: [(identifier) (qualified_name)] @import_name) @import
  `,

    // C/C++ imports
    // Example: #include <stdio.h>
    c: `
    (preproc_include
      path: [(system_lib_string) (string_literal)] @import_source) @import
  `,
    cpp: `
    (preproc_include
      path: [(system_lib_string) (string_literal)] @import_source) @import
  `,
};
