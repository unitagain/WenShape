const { Menu, Tray, nativeImage } = require("electron");

function createTrayIcon() {
  const svg = [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 64 64\">",
    "<rect width=\"64\" height=\"64\" rx=\"16\" fill=\"#0f172a\" />",
    "<path d=\"M20 18h9l8 22 8-22h9L40 48h-8L20 18z\" fill=\"#38bdf8\" />",
    "<circle cx=\"48\" cy=\"18\" r=\"6\" fill=\"#f59e0b\" />",
    "</svg>"
  ].join("");

  const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  return image.resize({ width: 16, height: 16 });
}

function createTrayController(options = {}) {
  const tray = new Tray(createTrayIcon());

  function buildContextMenu() {
    return Menu.buildFromTemplate([
      {
        label: "Open WenShape",
        click: () => options.showWindow?.()
      },
      {
        label: "Hide To Tray",
        click: () => options.hideWindow?.()
      },
      { type: "separator" },
      {
        label: "Open Logs Directory",
        click: () => options.openLogsDirectory?.()
      },
      {
        label: "Open Data Directory",
        click: () => options.openDataDirectory?.()
      },
      { type: "separator" },
      {
        label: "Quit WenShape",
        click: () => options.requestQuit?.({ source: "tray" })
      }
    ]);
  }

  tray.setToolTip("WenShape");
  tray.setContextMenu(buildContextMenu());
  tray.on("click", () => {
    options.showWindow?.();
  });

  return {
    setStatus(status) {
      const suffix = status?.message ? ` - ${status.message}` : "";
      tray.setToolTip(`WenShape${suffix}`);
    },
    destroy() {
      tray.destroy();
    }
  };
}

module.exports = {
  createTrayController
};
