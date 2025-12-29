#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("code-synapse")
  .description("An agent-first knowledge engine for AI coding assistants")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize the knowledge graph for the current project")
  .action(async () => {
    console.log("Initializing Code-Synapse...");
    // TODO: Implement initialization
  });

program
  .command("start")
  .description("Start the MCP server")
  .action(async () => {
    console.log("Starting Code-Synapse MCP server...");
    // TODO: Implement MCP server
  });

program.parse();
