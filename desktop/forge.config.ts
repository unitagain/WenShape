const config = {
  packagerConfig: {
    executableName: "WenShape",
    appBundleId: "com.wenshape.desktop",
    appCategoryType: "public.app-category.productivity",
    asar: true,
    protocols: [
      {
        name: "WenShape Deep Link",
        schemes: ["wenshape"]
      }
    ],
    ignore: [
      /^\/node_modules\/\.cache/,
      /^\/out/,
      /^\/release/
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"]
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    }
  ],
  plugins: []
};

export default config;
