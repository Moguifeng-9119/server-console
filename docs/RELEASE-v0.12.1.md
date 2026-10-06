## 0.12.1 — Window controls and multilingual layout

- Keep native Windows window controls in a separate title-bar band. Settings, transfer drawers and dialog overlays begin below it.
- Let long translated labels wrap within toolbars, settings controls, sidebar actions and dialog footers. Transfer drawers adapt to narrow windows.
- Add ten-language layout regressions to source CI and packaged-window checks to native CI, including Windows 100%, 125% and 150% scaling and maximized windows.

Packages remain unsigned. This patch changes layout and interaction spacing; it retains the transfer recovery and other features introduced in 0.12.0.
