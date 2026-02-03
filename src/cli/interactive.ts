import chalk from "chalk";
import * as readline from "node:readline";
import type { createLLMJustificationService, ClarificationBatch } from "../core/justification/index.js";

/**
 * Create a readline interface for interactive mode
 */
export function createReadlineInterface(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

/**
 * Ask a question and get user input
 */
export async function askQuestion(
    rl: readline.Interface,
    question: string
): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

/**
 * Run interactive clarification workflow
 */
export async function runInteractiveClarification(
    service: ReturnType<typeof createLLMJustificationService>,
    autoContinue: boolean = false
): Promise<void> {
    const rl = createReadlineInterface();

    console.log();
    console.log(chalk.cyan.bold("Interactive Clarification Mode"));
    console.log(chalk.dim("─".repeat(50)));
    console.log(chalk.dim("Answer questions to improve code understanding."));
    console.log(chalk.dim("Press Enter to skip, Ctrl+C to exit."));
    console.log();

    try {
        let batch: ClarificationBatch;

        while (true) {
            batch = await service.getNextClarificationBatch(5);

            if (batch.questions.length === 0) {
                console.log(chalk.green("No more questions! All entities clarified."));
                break;
            }

            console.log(
                chalk.white.bold(
                    `Questions (${batch.questions.length} of ${batch.totalPendingEntities} pending)`
                )
            );
            console.log();

            const answers = new Map<string, string>();

            for (const question of batch.questions) {
                console.log(chalk.cyan(`[${question.category}]`));
                console.log(chalk.white(question.question));

                if (question.context) {
                    console.log(chalk.dim(question.context));
                }

                if (question.suggestedAnswers && question.suggestedAnswers.length > 0) {
                    console.log(chalk.dim("Suggestions:"));
                    question.suggestedAnswers.forEach((suggestion, i) => {
                        console.log(chalk.dim(`  ${i + 1}. ${suggestion}`));
                    });
                }

                const answer = await askQuestion(rl, chalk.green("> "));

                if (answer) {
                    // Check if answer is a number (selecting from suggestions)
                    const suggestionIndex = parseInt(answer, 10) - 1;
                    if (
                        !isNaN(suggestionIndex) &&
                        question.suggestedAnswers &&
                        suggestionIndex >= 0 &&
                        suggestionIndex < question.suggestedAnswers.length
                    ) {
                        answers.set(question.id, question.suggestedAnswers[suggestionIndex]!);
                    } else {
                        answers.set(question.id, answer);
                    }
                    console.log(chalk.green("✓ Saved"));
                } else {
                    console.log(chalk.dim("Skipped"));
                }

                console.log();
            }

            // Apply answers
            if (answers.size > 0) {
                await service.applyClarificationAnswers(answers);
                console.log(chalk.green(`Applied ${answers.size} answer(s)`));
            }

            // Ask if user wants to continue
            if (!autoContinue) {
                const continueAnswer = await askQuestion(
                    rl,
                    chalk.dim("Continue with more questions? (Y/n) ")
                );
                if (
                    continueAnswer.toLowerCase() === "n" ||
                    continueAnswer.toLowerCase() === "no"
                ) {
                    break;
                }
            }

            console.log();
        }
    } finally {
        rl.close();
    }
}
