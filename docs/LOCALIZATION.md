# Localization status

The selector retains ten languages and i18next falls back to English for missing strings.

| Area | Maintained in this change | Remaining boundary |
| --- | --- | --- |
| Resource workbench, history, alert center, credential mode | English and Simplified Chinese | Other languages fall back to English for new strings |
| Main navigation, server manager, GPU/process panel, settings, transfer center | Main business labels use existing/new English and Chinese keys | Remote command output/error messages are not translated by the app |
| SSH config importer, file manager, terminal, parallel commands | Existing behavior retained; importer gains modal keyboard behavior | Older hardcoded Chinese labels still need migration |
| Documentation | English/Simplified Chinese detailed guides; other languages have current entry pages | Full documentation translations need contributors |

Do not describe the application as fully translated into ten languages. New locale keys should preserve units and interpolation names. Validate English/Chinese in both themes, then test each supported translation when extending it. Repository screenshots show the source version with simulated data.
