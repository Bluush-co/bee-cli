import pkg from "../package.json" with { type: "json" };

type PackageJson = {
  name: string;
  version: string;
};

const { name, version } = pkg as PackageJson;

export const PACKAGE_NAME = name;
export const VERSION = version;
