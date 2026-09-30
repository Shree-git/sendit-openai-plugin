/**
 * Minimal interactive prompts using raw stdin/stdout.
 * No external dependencies required.
 */

import * as readline from 'node:readline';

function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface();
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function select(
  label: string,
  options: { value: string; name: string }[]
): Promise<string> {
  console.log(`\n${label}\n`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}) ${options[i].name}`);
  }
  console.log();

  const rl = createInterface();
  return new Promise((resolve) => {
    const prompt = () => {
      rl.question(`Enter choice (1-${options.length}): `, (answer) => {
        const idx = parseInt(answer.trim(), 10) - 1;
        if (idx >= 0 && idx < options.length) {
          rl.close();
          resolve(options[idx].value);
        } else {
          console.log(`  Invalid choice. Please enter a number between 1 and ${options.length}.`);
          prompt();
        }
      });
    };
    prompt();
  });
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? '(Y/n)' : '(y/N)';
  const answer = await ask(`${question} ${suffix} `);
  if (answer === '') return defaultYes;
  return answer.toLowerCase().startsWith('y');
}
