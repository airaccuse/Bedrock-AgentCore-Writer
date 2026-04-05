import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const bundleRoot = path.join(projectRoot, "infra", "terraform", ".build", "runtime-bundle");

function run(command: string, args: string[], cwd = projectRoot): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function copyDir(source: string, destination: string): void {
  fs.cpSync(source, destination, { recursive: true });
}

function main(): void {
  run("npm", ["run", "build"]);

  fs.rmSync(bundleRoot, { recursive: true, force: true });
  fs.mkdirSync(bundleRoot, { recursive: true });

  copyDir(path.join(projectRoot, "dist"), path.join(bundleRoot, "dist"));
  copyDir(path.join(projectRoot, "prompts"), path.join(bundleRoot, "prompts"));
  copyDir(path.join(projectRoot, "schemas"), path.join(bundleRoot, "schemas"));

  fs.copyFileSync(path.join(projectRoot, "package.json"), path.join(bundleRoot, "package.json"));
  fs.copyFileSync(path.join(projectRoot, "package-lock.json"), path.join(bundleRoot, "package-lock.json"));

  run("npm", ["ci", "--omit=dev"], bundleRoot);

  console.log(`Lambda runtime bundle prepared at ${bundleRoot}`);
}

main();