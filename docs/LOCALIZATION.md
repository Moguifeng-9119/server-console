# Localization status

The selector retains ten languages and i18next falls back to English for missing strings.

| Area | Maintained in this change | Remaining boundary |
| --- | --- | --- |
| Resource workbench, history, alert center, credential mode | English and Simplified Chinese | Other languages fall back to English for new strings |
| Main navigation, server manager, GPU/process panel, settings, transfer center | Main business labels use existing/new English and Chinese keys | Remote command output/error messages are not translated by the app |
| SSH config importer, file manager, terminal, parallel commands | Existing behavior retained; importer gains modal keyboard behavior | Older hardcoded Chinese labels still need migration |
| README guides | Ten substantive usage guides with the same ten-language navigation on every page | Linked technical documents remain primarily English; screenshots show English/Chinese UI |

Each README covers the product scope, download, source demo versus desktop usage, transfers/credentials, verification boundaries, development and contributions. This is distinct from application localization.

As checked on 2026-10-06, English and Simplified Chinese each have 604 leaf translation keys. Each other locale has 153, missing 451 relative to English. FileManager, ImportSshConfig, ServerRelay, ParallelCommand, ConfigWatchBanner and TextViewer still contain hardcoded Chinese business labels. See the [original assessment follow-up](ASSESSMENT-STATUS.zh-CN.md).

Do not describe the application as fully translated into ten languages. New locale keys should preserve units and interpolation names. Validate English/Chinese in both themes, then test each supported translation when extending it. Repository screenshots show the source version with simulated data.
