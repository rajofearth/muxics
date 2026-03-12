#!/usr/bin/env bun
/**
 * Runs the Linux-only postPackage hook.
 */

export {};

const OS = process.env.ELECTROBUN_OS;

if (OS === "linux") {
  await import("./create-appimage.ts");
}
