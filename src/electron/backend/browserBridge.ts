import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { app } from "electron";
import { APP_DATA_PATH } from "./paths";

export const BROWSER_BRIDGE_EXTENSION_ID = "ckdbikknfopiifdpiamjoeakhcljifjm";
export const BROWSER_BRIDGE_HOST_NAME = "dev.muxics.player.native";
const BROWSER_BRIDGE_DIR = path.join(APP_DATA_PATH, "browser-bridge");
const STAGED_EXTENSION_DIR = path.join(BROWSER_BRIDGE_DIR, "extension");
const STAGED_EXTENSION_ZIP = path.join(BROWSER_BRIDGE_DIR, "muxics-browser-bridge.zip");
const NATIVE_HOST_DIR = path.join(BROWSER_BRIDGE_DIR, "native-host");
const EXTENSION_SOURCE_DIR = path.join(app.getAppPath(), "assets", "browser-extension");
const EXTENSION_ORIGIN = `chrome-extension://${BROWSER_BRIDGE_EXTENSION_ID}/`;

function ensureBridgeDirs(): void {
  fs.mkdirSync(BROWSER_BRIDGE_DIR, { recursive: true });
  fs.mkdirSync(NATIVE_HOST_DIR, { recursive: true });
}

function copyDirRecursive(source: string, target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function createZipArchive(sourceDir: string, targetZip: string): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  try {
    if (fs.existsSync(targetZip)) {
      fs.unlinkSync(targetZip);
    }

    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($args[0], $args[1])",
        sourceDir,
        targetZip,
      ],
      { stdio: "ignore" },
    );

    return fs.existsSync(targetZip) ? targetZip : undefined;
  } catch {
    return undefined;
  }
}

function getLauncherCommand(): string {
  if (app.isPackaged) {
    return `"${process.execPath}" --muxics-native-host`;
  }

  return `"${process.execPath}" "${app.getAppPath()}" --muxics-native-host`;
}

function writeNativeHostLauncher(): string {
  ensureBridgeDirs();

  const launcherPath = path.join(NATIVE_HOST_DIR, "muxics-native-host.cmd");
  const contents = `@echo off\r\n${getLauncherCommand()}\r\n`;
  fs.writeFileSync(launcherPath, contents, "utf-8");
  return launcherPath;
}

function writeNativeHostManifest(targetName: "chrome" | "edge", launcherPath: string): string {
  ensureBridgeDirs();

  const manifestPath = path.join(NATIVE_HOST_DIR, `${targetName}.json`);
  const manifest = {
    name: BROWSER_BRIDGE_HOST_NAME,
    description: "Muxics Browser Bridge",
    path: launcherPath,
    type: "stdio",
    allowed_origins: [EXTENSION_ORIGIN],
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  return manifestPath;
}

function registerNativeHostManifest(browser: "chrome" | "edge", manifestPath: string): void {
  const registryPath = browser === "chrome"
    ? `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${BROWSER_BRIDGE_HOST_NAME}`
    : `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${BROWSER_BRIDGE_HOST_NAME}`;

  execFileSync(
    "reg.exe",
    ["add", registryPath, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"],
    { stdio: "ignore" },
  );
}

export function prepareBrowserBridgeBundle() {
  try {
    ensureBridgeDirs();
    copyDirRecursive(EXTENSION_SOURCE_DIR, STAGED_EXTENSION_DIR);
    const zipPath = createZipArchive(STAGED_EXTENSION_DIR, STAGED_EXTENSION_ZIP);

    return {
      success: true,
      extensionId: BROWSER_BRIDGE_EXTENSION_ID,
      folderPath: STAGED_EXTENSION_DIR,
      zipPath,
    };
  } catch (error) {
    return {
      success: false,
      extensionId: BROWSER_BRIDGE_EXTENSION_ID,
      error: error instanceof Error ? error.message : "Failed to prepare browser bridge bundle.",
    };
  }
}

export function installBrowserBridgeHost() {
  if (process.platform !== "win32") {
    return {
      success: false,
      extensionId: BROWSER_BRIDGE_EXTENSION_ID,
      hostName: BROWSER_BRIDGE_HOST_NAME,
      error: "Browser bridge host install is currently supported on Windows only.",
    };
  }

  try {
    const launcherPath = writeNativeHostLauncher();
    const chromeManifest = writeNativeHostManifest("chrome", launcherPath);
    const edgeManifest = writeNativeHostManifest("edge", launcherPath);
    registerNativeHostManifest("chrome", chromeManifest);
    registerNativeHostManifest("edge", edgeManifest);

    return {
      success: true,
      extensionId: BROWSER_BRIDGE_EXTENSION_ID,
      hostName: BROWSER_BRIDGE_HOST_NAME,
    };
  } catch (error) {
    return {
      success: false,
      extensionId: BROWSER_BRIDGE_EXTENSION_ID,
      hostName: BROWSER_BRIDGE_HOST_NAME,
      error: error instanceof Error ? error.message : "Failed to install the browser bridge host.",
    };
  }
}
