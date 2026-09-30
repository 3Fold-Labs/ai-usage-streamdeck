# Privacy and local data

AI Usage reads supported subscription-usage information from local provider applications or directly from provider services. Selected integrations require explicit enablement. No 3Fold usage backend or product telemetry is included in this snapshot.

Stored local data can include account nicknames and identifiers, selected display settings, usage readings, and timestamps. The usage cache is designed not to contain passwords or access tokens. Provider apps and CLIs may store their own credentials, including in managed sign-in directories. This distinction matters: no credentials in the usage cache does not mean no credentials on disk.

The optional Claude Code exporter can update a status-line setting and create local helper files. Native Stream Deck uninstall does not currently guarantee removal or restoration of all external files and settings. Review the known limitations before enabling it.

Do not share account folders, authentication files, raw provider responses, or unredacted logs in public issues. Provider services remain subject to their own terms and privacy policies.

This document describes the source snapshot; it is not a security certification or a promise that local data cannot be compromised.

## Credential access boundary

Publishing or downloading this source does not grant access to another user's provider sign-ins. There is no shared 3Fold credential service. Each installation uses credentials available to its local operating-system account and sends authenticated usage requests directly to the configured provider endpoints.

This is not an isolation boundary against software running as the same operating-system user, an administrator, malware, or someone with access to account-folder backups. Some provider tools store reusable credentials locally. Protect those folders and backups, keep the operating system and provider apps updated, and revoke provider sessions if a device or credential file is exposed.
