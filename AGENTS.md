# AI Usage maintenance

Read README.md, CONTRIBUTING.md and SECURITY.md before changing the product.

- Maintain one full-featured open-source plugin. Keep the stable plugin UUID and action IDs.
- Claude uses ordinary text only. Preserve the other provider artwork.
- Edit maintained sources in src/, then regenerate the packaged runtime and inspector with npm run build. Do not patch bundled output directly.
- Respect the module layers in CONTRIBUTING.md. No runtime import cycles or browser/Node cross-imports.
- Use synthetic data in tests. Never commit provider sign-ins, account records, personal paths, private correspondence or credentials. Never log raw provider responses or exceptions.
- Run lint, format:check, check, build:check and the tests; run security:release for a release candidate. A passing automated suite does not substitute for physical platform acceptance.
- Preserve the original private development repository. Only this sanitized source history belongs in the public repository.
