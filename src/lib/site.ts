export const SITE_URL = "https://legends.carterscoding.com";
export const SITE_NAME = "Basketball Legends";
export const REPO_URL = "https://github.com/cksarge/Basketball-Legends";

/** "beta" for the prerelease build served at /beta/ (built with BL_CHANNEL=beta), otherwise the live game. */
export const IS_BETA = process.env.APP_CHANNEL === "beta";
/** Path prefix the site is served under: "" for the live game, "/beta" for the beta. */
export const BASE_PATH = process.env.APP_BASE_PATH ?? "";
/** Prefixes a root-relative file path (models, logos, icons) with the base path. next/link and the router add it to page links on their own. */
export const asset = (path: string) => BASE_PATH + path;
