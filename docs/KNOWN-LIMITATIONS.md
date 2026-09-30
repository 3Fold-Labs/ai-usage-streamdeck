# Known limitations

- Source and packaged-runtime checks do not replace physical Stream Deck acceptance of the installer.
- Native uninstall cleanup is incomplete. The Claude exporter can leave an external configuration change; managed account data may remain after the plugin is removed. Do not delete a provider configuration folder wholesale.
- Provider CLI authentication may persist on disk according to the provider tool's behavior. Never describe this as credentials existing nowhere.
- Cursor follows its active signed-in account; it does not offer multiple independently pinned simultaneous accounts.
- Usage windows and resets depend on provider responses. Missing information stays unavailable.
- Undocumented provider interfaces can change. Provider terms and permissions remain separate from this project's software license.
- Third-party names and artwork remain subject to their owners’ rights. The MIT license covers this project’s code, not those marks. Claude uses plain text only.
