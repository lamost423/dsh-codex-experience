# Repository guidance

This repository contains out-of-tree DeepSeek Harness plugins. Keep the conversation UI, todo Guard, and combined bundle independently installable. Do not import or publish packages under the `@deepseek-ai` scope. Preserve the `dsh.bundle.patch` declarations and test against the explicit Harness version documented in the root README.

Run `pnpm check` before every push. Do not commit `lib/`, `artifacts/`, credentials, DSH profiles, or user Session data.
