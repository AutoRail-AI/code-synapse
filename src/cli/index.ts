#!/usr/bin/env node

/**
 * Code-Synapse CLI
 * User-facing command line interface for configuration and server management
 */

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";

const program = new Command();

program
  .name("code-synapse")
  .description("An agent-first knowledge engine for AI coding assistants")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize Code-Synapse for the current project")
  .option("-f, --force", "Force reinitialization")
  .action(initCommand);

program
  .command("start")
  .description("Start the MCP server")
  .option("-p, --port <port>", "Port to run the server on", parseInt)
  .action(startCommand);

program
  .command("index")
  .description("Manually trigger a full project index")
  .action(async () => {
    console.log("Indexing project...");
    // TODO: Implement manual indexing
  });

program
  .command("status")
  .description("Show the current status of Code-Synapse")
  .action(async () => {
    console.log("Checking status...");
    // TODO: Implement status check
  });

program.parse();
