# Localization status

The README has ten substantive language pages with the same navigation on each page. Detailed recovery and development guides are available in [English](USER-GUIDE.md) and [Simplified Chinese](USER-GUIDE.zh-CN.md).

The application retains English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Russian and Brazilian Portuguese. All ten resource files now have the same 635 leaf keys and matching interpolation parameters. Previously, eight locales had only 153 keys relative to 604 English keys. Importer, files, relay, parallel commands, config notices and text editing now use the locale resources instead of hardcoded Chinese business labels.

Nine locales are loaded on demand; English is the bundled fallback. Ten contract tests reject missing keys, empty strings, broken interpolation and translation artifacts. Browser workflow checks load, switch and reload every locale, including the file manager. Delayed competing language requests were also tested with unsaved text and incoming monitoring/transfer events.

English/Simplified Chinese are maintained directly. The other languages include existing translations and machine-assisted drafts, with manual corrections for the workbench, resource/credential observations, destructive file actions, prefix recovery, cleanup, checksum and unsaved-draft prompts. Native-speaker review of all remaining wording is still pending. Key completeness and a successful render should not be described as professional translation certification.

Remote command output and backend error details remain in the language supplied by the remote tool or backend. Technical names, paths, units and template parameters are intentionally preserved. Linked technical documents are mainly English/Chinese; README language coverage does not imply every linked document is translated.
